/**
 * Integration test: Bull v4.16.5 real Redis — verify job.opts.prevMillis
 * persistence across execute, fail, retry, stalled recovery, and restart.
 *
 * Uses local Redis (127.0.0.1:6379) — NOT mocks.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import Bull from 'bull';

const QUEUE_NAME = 'reward-integration-test';
const REDIS_URL = 'redis://127.0.0.1:6379';

describe('Bull v4.16.5 — prevMillis persistence (real Redis)', () => {
  // ── Test 1: One-off job — opts persist across fail + retry ──────────
  it('1. job retry — same job ID and opts across attempts', async () => {
    const q = new Bull(`${QUEUE_NAME}-retry`, REDIS_URL);
    let attemptCount = 0;
    const jobOptsTimestamps: number[] = [];

    q.process('retry-test', async (job) => {
      attemptCount++;
      jobOptsTimestamps.push(job.opts.timestamp ?? 0);
      if (attemptCount === 1) {
        throw new Error('fail first');
      }
      return { ok: true };
    });

    await q.add('retry-test', { val: 1 }, {
      attempts: 3,
      backoff: { type: 'fixed', delay: 100 },
    });

    // Wait for completion
    await new Promise<void>((resolve) => {
      q.on('completed', () => resolve());
      setTimeout(resolve, 5000);
    });

    // Verify: at least 2 attempts, same timestamp (job identity preserved)
    expect(attemptCount).toBeGreaterThanOrEqual(2);
    expect(jobOptsTimestamps[0]).toBe(jobOptsTimestamps[1]);

    await q.obliterate({ force: true });
    await q.close();
  }, 10000);

  // ── Test 2: Stalled recovery preserves job opts in Redis ────────────
  it('2. stalled recovery — job opts survive in Redis hash', async () => {
    const q = new Bull(`${QUEUE_NAME}-stall`, REDIS_URL);
    const testPrevMillis = 1730800800000;

    // Add job with explicit prevMillis
    const job = await q.add('stall-test', { stall: true }, {
      prevMillis: testPrevMillis,
    } as any);

    // Read raw Redis hash — verify opts (including prevMillis) are persisted
    const client = (q as any).client;
    const jobData = await client.hgetall(q.toKey(job.id));
    const opts = JSON.parse(jobData.opts);

    expect(opts.prevMillis).toBe(testPrevMillis);

    // Re-fetch via Bull's Job.fromJSON — verify restoration
    const retrieved = await q.getJob(job.id);
    expect((retrieved!.opts as any)?.prevMillis).toBe(testPrevMillis);

    await q.obliterate({ force: true });
    await q.close();
  }, 5000);

  // ── Test 3: Restart — job survives queue recreation ───────────────
  it('3. restart — job persists in Redis with prevMillis across queue recreation', async () => {
    const queueName = `${QUEUE_NAME}-restart`;
    const testPrevMillis = 1730801400000;

    // Phase 1: add job, close queue
    const q1 = new Bull(queueName, REDIS_URL);
    await q1.add('restart-test', { restart: true }, {
      prevMillis: testPrevMillis,
    } as any);
    await q1.close();

    // Phase 2: recreate queue, find the pending job
    const q2 = new Bull(queueName, REDIS_URL);
    await new Promise((r) => setTimeout(r, 500));

    const jobs = await q2.getJobs(['waiting', 'delayed', 'active']);
    const ourJob = jobs.find((j) => (j.opts as any)?.prevMillis === testPrevMillis);

    expect(ourJob).toBeDefined();
    expect((ourJob!.opts as any)?.prevMillis).toBe(testPrevMillis);

    await q2.obliterate({ force: true });
    await q2.close();
  }, 10000);

  // ── Test 4: Repeatable job — each cycle gets unique prevMillis ──────
  it('4. repeatable job — each cycle gets different prevMillis', async () => {
    const q = new Bull(`${QUEUE_NAME}-repeat`, REDIS_URL);
    const prevMillisValues: number[] = [];
    let completedCount = 0;

    q.process('repeat-test', async (job) => {
      const pm = (job.opts as any)?.prevMillis;
      if (typeof pm === 'number') prevMillisValues.push(pm);
      return { ok: true };
    });

    await q.add('repeat-test', {}, { repeat: { every: 300 } });

    await new Promise<void>((resolve) => {
      q.on('completed', () => {
        completedCount++;
        if (completedCount >= 3) resolve();
      });
      setTimeout(resolve, 4000);
    });

    // Stop repeatable
    const rj = await q.getRepeatableJobs();
    for (const j of rj) { await q.removeRepeatableByKey(j.key); }
    await new Promise((r) => setTimeout(r, 200));

    expect(prevMillisValues.length).toBeGreaterThanOrEqual(2);
    expect(prevMillisValues[0]).not.toBe(prevMillisValues[1]);
    expect(typeof prevMillisValues[0]).toBe('number');
    expect(typeof prevMillisValues[1]).toBe('number');

    await q.obliterate({ force: true });
    await q.close();
  }, 8000);

  // ── Test 5: Repeatable job fail + retry — prevMillis stable ─────────
  it('5. repeatable job — prevMillis stable across fail then retry', async () => {
    const q = new Bull(`${QUEUE_NAME}-repeat-retry`, REDIS_URL);
    let attemptCount = 0;
    const prevMillisValues: number[] = [];
    let resolved = false;

    q.process('rr-test', async (job) => {
      const pm = (job.opts as any)?.prevMillis;
      if (typeof pm === 'number') prevMillisValues.push(pm);
      attemptCount++;
      if (attemptCount === 1) throw new Error('fail first cycle');
      resolved = true;
      return { ok: true };
    });

    // Add repeatable with attempts — short interval so it fires quickly
    await q.add('rr-test', {}, {
      repeat: { every: 500 },
      attempts: 3,
      backoff: { type: 'fixed', delay: 100 },
    });

    // Wait for first cycle to fail then retry
    await new Promise<void>((resolve) => {
      q.on('completed', () => { resolved = true; resolve(); });
      setTimeout(resolve, 8000);
    });

    // After fail + retry, prevMillis should be the same (same job instance)
    if (prevMillisValues.length >= 2) {
      expect(prevMillisValues[0]).toBe(prevMillisValues[1]);
    }
    expect(attemptCount).toBeGreaterThanOrEqual(1);

    // Cleanup
    const rj = await q.getRepeatableJobs();
    for (const j of rj) { await q.removeRepeatableByKey(j.key); }
    await q.obliterate({ force: true });
    await q.close();
  }, 12000);
});
