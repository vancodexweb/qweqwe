import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Rate-limit по произвольному ключу (nickname, userId и т.д.), поверх Redis.
 *
 * Зачем это нужно в дополнение к @nestjs/throttler: встроенный ThrottlerGuard
 * считает попытки только по IP. Это не защищает конкретный аккаунт от
 * распределённого брутфорса (много IP, один nickname) и не защищает от
 * спама Telegram-кодами одним и тем же авторизованным пользователем.
 * Поэтому критичные операции дополнительно лимитируются здесь — по nickname
 * при логине и по userId при старте привязки Telegram.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `ratelimit:${key}`;
    const count = await this.redis.incrWithExpiry(redisKey, windowSeconds);
    const ttl = await this.redis.ttl(redisKey);
    const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;

    return {
      allowed: count <= limit,
      remaining: Math.max(limit - count, 0),
      retryAfterSeconds,
    };
  }
}
