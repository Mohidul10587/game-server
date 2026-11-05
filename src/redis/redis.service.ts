import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

@Injectable()
export class RedisService implements OnModuleInit {
  private client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('UPSTASH_REDIS_REST_URL');
    const token = this.config.get<string>('UPSTASH_REDIS_REST_TOKEN');

    if (!url || !token) {
      throw new Error(
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in .env',
      );
    }

    this.client = new Redis({ url, token });
    this.logger.log('Upstash Redis client initialized');
  }

  // ── Safe wrapper — returns fallback on error ──────────────────────────────
  private async safe<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (err: any) {
      this.logger.error('Redis operation failed:', err?.message ?? err);
      return fallback;
    }
  }

  // ── Mining power hash ─────────────────────────────────────────────────────
  async hset(key: string, field: string, value: string): Promise<number> {
    return this.safe(
      () => this.client.hset(key, { [field]: value }),
      0,
    );
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.safe(
      async () => {
        const val = await this.client.hget<string>(key, field);
        return val ?? null;
      },
      null,
    );
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.safe(
      async () => {
        const result = await this.client.hgetall<Record<string, string>>(key);
        return result ?? {};
      },
      {},
    );
  }

  async hincrby(key: string, field: string, amount: number): Promise<number> {
    return this.safe(
      () => this.client.hincrby(key, field, amount),
      0,
    );
  }

  async hdel(key: string, field: string): Promise<number> {
    return this.safe(
      () => this.client.hdel(key, field),
      0,
    );
  }

  // ── Rate limiting / generic keys ─────────────────────────────────────────
  async incr(key: string): Promise<number> {
    return this.safe(() => this.client.incr(key), 0);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.safe(
      async () => {
        const ok = await this.client.expire(key, seconds);
        return ok ? 1 : 0;
      },
      0,
    );
  }

  async get(key: string): Promise<string | null> {
    return this.safe(
      async () => {
        const val = await this.client.get<string>(key);
        return val ?? null;
      },
      null,
    );
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.safe(async () => {
      if (ttlSeconds) {
        await this.client.set(key, value, { ex: ttlSeconds });
      } else {
        await this.client.set(key, value);
      }
    }, undefined);
  }

  async del(key: string): Promise<number> {
    return this.safe(() => this.client.del(key), 0);
  }
}
