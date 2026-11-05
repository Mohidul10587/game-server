import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RewardWorker } from './reward.worker.js';

// ─────────────────────────────────────────────────────────────────────
// Helpers — build mock Job objects with Bull v4 structure
// ─────────────────────────────────────────────────────────────────────

type MockJobOpts = {
  prevMillis?: number;
  repeat?: { every: number; count: number; key: string };
  attempts?: number;
  jobId?: string;
  timestamp?: number;
};

function createMockJob(opts?: MockJobOpts) {
  return {
    opts: opts ?? {},
    id: opts?.jobId ?? 'test-job-id',
    data: {},
    timestamp: opts?.timestamp ?? Date.now(),
    attemptsMade: 0,
  } as any;
}

// ─────────────────────────────────────────────────────────────────────
// Mock factories — PrismaService and RedisService
// ─────────────────────────────────────────────────────────────────────

function createMockPrisma(
  overrides: {
    rewardConfig?: any;
    miningPowerFindMany?: any;
    miningPowerUpdateMany?: any;
    rewardHistoryCreate?: any;
    cryptoBalanceUpsert?: any;
  } = {},
) {
  const mockTx = {
    rewardHistory: {
      create: vi.fn(overrides.rewardHistoryCreate ?? (async () => {})),
    },
    cryptoBalance: {
      upsert: vi.fn(overrides.cryptoBalanceUpsert ?? (async () => {})),
    },
  };

  return {
    rewardConfig: {
      findFirst: vi.fn(
        overrides.rewardConfig ??
          (async () => ({ poolAmountPerCycle: 1000 })),
      ),
    },
    miningPower: {
      findMany: vi.fn(
        overrides.miningPowerFindMany ?? (async () => []),
      ),
      updateMany: vi.fn(
        overrides.miningPowerUpdateMany ?? (async () => ({ count: 0 })),
      ),
    },
    rewardHistory: {
      create: mockTx.rewardHistory.create,
    },
    cryptoBalance: {
      upsert: mockTx.cryptoBalance.upsert,
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(mockTx)),
    // Allow tests to override $transaction behaviour
    _mockTx: mockTx,
  };
}

function createMockRedis(powersMap: Record<string, string> = {}) {
  return {
    hgetall: vi.fn(async () => powersMap),
    hset: vi.fn(async () => 1),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('RewardWorker — cycle-based idempotency', () => {
  let worker: RewardWorker;
  let mockPrisma: any;
  let mockRedis: any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Scenario 1: Same cycle executed twice ──────────────────────────
  it('1. duplicate cycle — second execution skips already-rewarded users via P2002', async () => {
    const prevMillis = new Date('2026-11-05T10:00:00.000Z').getTime();
    const job = createMockJob({ prevMillis });

    let createCallCount = 0;
    const { PrismaClientKnownRequestError } = await import(
      '@prisma/client/runtime/library'
    ).catch(() => ({ PrismaClientKnownRequestError: null }));

    mockPrisma = createMockPrisma({
      rewardHistoryCreate: async () => {
        createCallCount++;
        if (createCallCount >= 2) {
          // Second call for same user in same cycle → simulate P2002
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          err.meta = { target: ['userId', 'cycleId', 'currency'] };
          throw err;
        }
      },
    });
    mockRedis = createMockRedis({ user1: '100' });

    worker = new RewardWorker(mockPrisma, mockRedis as any);

    // First execution — normal distribution
    await worker.handleDistribute(job);
    expect(createCallCount).toBe(1);

    // Second execution — same job, same prevMillis → same cycleId
    // P2002 thrown on rewardHistory.create → balance NOT incremented
    await worker.handleDistribute(job);

    // Verify rewardHistory.create was called twice (once per execution)
    expect(mockPrisma._mockTx.rewardHistory.create).toHaveBeenCalledTimes(2);

    // cryptoBalance.upsert should only succeed once (first execution)
    // Second execution's tx should rollback → upsert may be called but tx fails
    // The P2002 is caught, so the worker doesn't throw
    expect(mockPrisma._mockTx.cryptoBalance.upsert).toHaveBeenCalledTimes(1);
  });

  // ── Scenario 2: 10:09 execute, 10:11 stalled retry ──────────────────
  it('2. stalled retry — same cycleId across time gap via job.opts.prevMillis', async () => {
    // Job scheduled for 10:00 (prevMillis = 10:00)
    const prevMillis10 = new Date('2026-11-05T10:00:00.000Z').getTime();
    const job10 = createMockJob({ prevMillis: prevMillis10 });

    let createCallCount = 0;
    mockPrisma = createMockPrisma({
      rewardHistoryCreate: async () => {
        createCallCount++;
        if (createCallCount >= 2) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
      },
    });
    mockRedis = createMockRedis({ user1: '100' });
    worker = new RewardWorker(mockPrisma, mockRedis as any);

    // First execution at 10:09 — uses prevMillis = 10:00 (scheduled time, not execution time)
    // Real execution time is different, but prevMillis is stable
    await worker.handleDistribute(job10);

    // Stalled recovery re-runs SAME job at 10:11 — same job, same opts.prevMillis = 10:00
    // → same cycleId → P2002 → skipped
    await worker.handleDistribute(job10);

    // Both executions used the same cycleId derived from prevMillis
    const firstCreateArg = mockPrisma._mockTx.rewardHistory.create.mock.calls[0][0];
    const secondCreateArg = mockPrisma._mockTx.rewardHistory.create.mock.calls[1][0];

    expect(firstCreateArg.data.cycleId).toBe('2026-11-05T10:00:00.000Z');
    expect(secondCreateArg.data.cycleId).toBe('2026-11-05T10:00:00.000Z');
    expect(firstCreateArg.data.cycleId).toBe(secondCreateArg.data.cycleId);
  });

  // ── Scenario 3: Transaction failure mid-distribution ─────────────────
  it('3. tx failure — non-P2002 error propagates and job fails', async () => {
    const prevMillis = new Date('2026-11-05T10:00:00.000Z').getTime();
    const job = createMockJob({ prevMillis });

    const dbError: any = new Error('Connection lost');
    dbError.code = 'P1001'; // Connection error, not P2002

    mockPrisma = createMockPrisma({
      rewardHistoryCreate: async () => {
        throw dbError;
      },
    });
    mockRedis = createMockRedis({ user1: '100' });
    worker = new RewardWorker(mockPrisma, mockRedis as any);

    // The worker should throw because a non-P2002 error occurred
    await expect(worker.handleDistribute(job)).rejects.toThrow();
  });

  // ── Scenario 4: Duplicate RewardHistory insert ───────────────────────
  it('4. duplicate insert — P2002 skips user, balance NOT incremented', async () => {
    const prevMillis = new Date('2026-11-05T10:00:00.000Z').getTime();
    const job = createMockJob({ prevMillis });

    const p2002Error: any = new Error('Unique constraint failed');
    p2002Error.code = 'P2002';

    mockPrisma = createMockPrisma({
      rewardHistoryCreate: async () => {
        throw p2002Error;
      },
    });
    mockRedis = createMockRedis({ user1: '100' });
    worker = new RewardWorker(mockPrisma, mockRedis as any);

    // Worker should NOT throw — P2002 is handled gracefully
    await expect(worker.handleDistribute(job)).resolves.toBeUndefined();

    // cryptoBalance.upsert should NOT have been called because tx rolled back
    expect(mockPrisma._mockTx.cryptoBalance.upsert).not.toHaveBeenCalled();
  });

  // ── Scenario 5: Server restart — pending job re-executes ─────────────
  it('5. restart pending job — same prevMillis produces same cycleId', async () => {
    // Simulate a job that was scheduled before restart
    const prevMillis = new Date('2026-11-05T10:00:00.000Z').getTime();

    let createCallCount = 0;
    mockPrisma = createMockPrisma({
      rewardHistoryCreate: async () => {
        createCallCount++;
        if (createCallCount >= 2) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
      },
    });
    mockRedis = createMockRedis({ user1: '100' });

    // Before restart: job created with prevMillis
    const jobBeforeRestart = createMockJob({ prevMillis });
    worker = new RewardWorker(mockPrisma, mockRedis as any);
    await worker.handleDistribute(jobBeforeRestart);

    // After restart: same job picked up from wait queue
    // Bull restores job from Redis — opts.prevMillis preserved
    const jobAfterRestart = createMockJob({ prevMillis });
    worker = new RewardWorker(mockPrisma, mockRedis as any);
    await worker.handleDistribute(jobAfterRestart);

    // Same cycleId both times
    const firstArg = mockPrisma._mockTx.rewardHistory.create.mock.calls[0][0];
    const secondArg = mockPrisma._mockTx.rewardHistory.create.mock.calls[1][0];

    expect(firstArg.data.cycleId).toBe(secondArg.data.cycleId);
    expect(firstArg.data.cycleId).toBe('2026-11-05T10:00:00.000Z');

    // Only one successful balance update (first execution)
    expect(mockPrisma._mockTx.cryptoBalance.upsert).toHaveBeenCalledTimes(1);
  });

  // ── Scenario 6: Non-P2002 error → job fails ──────────────────────────
  it('6. non-P2002 error — job throws and marks as failed for Bull retry', async () => {
    const prevMillis = new Date('2026-11-05T10:00:00.000Z').getTime();
    const job = createMockJob({ prevMillis });

    const constraintError: any = new Error('Foreign key constraint failed');
    constraintError.code = 'P2003'; // Not P2002

    mockPrisma = createMockPrisma({
      rewardHistoryCreate: async () => {
        throw constraintError;
      },
    });
    mockRedis = createMockRedis({ user1: '100' });
    worker = new RewardWorker(mockPrisma, mockRedis as any);

    // Should throw — Bull marks job as failed, retries with same prevMillis
    await expect(worker.handleDistribute(job)).rejects.toThrow(
      /Cycle .* failed for 1 user\(s\)/,
    );

    // Balance should NOT be incremented
    expect(mockPrisma._mockTx.cryptoBalance.upsert).not.toHaveBeenCalled();
  });

  // ── Bonus: multiple users, one fails, others succeed ───────────────
  it('bonus. partial failure — failed user throws, successful users distributed', async () => {
    const prevMillis = new Date('2026-11-05T10:00:00.000Z').getTime();
    const job = createMockJob({ prevMillis });

    mockPrisma = createMockPrisma({
      rewardHistoryCreate: async (args: any) => {
        if (args.data.userId === 'user2') {
          const err: any = new Error('Connection timeout');
          err.code = 'P1001';
          throw err;
        }
        // user1 succeeds
      },
    });
    mockRedis = createMockRedis({ user1: '100', user2: '50' });
    worker = new RewardWorker(mockPrisma, mockRedis as any);

    // Should throw because user2 failed (non-P2002)
    await expect(worker.handleDistribute(job)).rejects.toThrow();

    // user1's balance upsert should have been called
    expect(mockPrisma._mockTx.cryptoBalance.upsert).toHaveBeenCalledTimes(1);
    // The first (and only) upsert call should be for user1
    expect(mockPrisma._mockTx.cryptoBalance.upsert.mock.calls[0][0].where.userId_currency.userId).toBe('user1');
  });
});
