import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../redis/redis.service';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Redis-backed rate limit storage so limits are shared across API instances.
 * Fails open (allows the request) if Redis is unavailable.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;
    try {
      const blockedTtl = await this.redis.client.pttl(blockKey);
      if (blockedTtl > 0) {
        return { totalHits: limit + 1, timeToExpire: Math.ceil(blockedTtl / 1000), isBlocked: true, timeToBlockExpire: Math.ceil(blockedTtl / 1000) };
      }
      const results = await this.redis.client.multi().incr(hitKey).pttl(hitKey).exec();
      const totalHits = Number(results?.[0]?.[1] ?? 1);
      let pttl = Number(results?.[1]?.[1] ?? -1);
      if (pttl < 0) {
        await this.redis.client.pexpire(hitKey, ttl);
        pttl = ttl;
      }
      if (totalHits > limit) {
        await this.redis.client.set(blockKey, '1', 'PX', blockDuration || ttl);
        return { totalHits, timeToExpire: Math.ceil(pttl / 1000), isBlocked: true, timeToBlockExpire: Math.ceil((blockDuration || ttl) / 1000) };
      }
      return { totalHits, timeToExpire: Math.ceil(pttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    } catch (err) {
      this.logger.warn(`Rate limiter unavailable: ${(err as Error).message}`);
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
