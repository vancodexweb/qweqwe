import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Тонкая обёртка над ioredis с JSON-хелперами. Используется для:
 *  - хранения одноразовых Telegram auth-кодов (см. TelegramCodeService);
 *  - счётчиков rate-limit (см. RateLimitService).
 */
@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /** Прямой доступ к клиенту ioredis для нестандартных операций. */
  getClient(): Redis {
    return this.client;
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /** Записать значение, сохранив оставшийся TTL ключа (в мс), если он был установлен. */
  async setJsonPreservingTtl<T>(key: string, value: T, fallbackTtlSeconds: number): Promise<void> {
    const remainingMs = await this.client.pttl(key);
    const payload = JSON.stringify(value);

    if (remainingMs && remainingMs > 0) {
      await this.client.set(key, payload, 'PX', remainingMs);
    } else {
      await this.client.set(key, payload, 'EX', fallbackTtlSeconds);
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.error(`Не удалось распарсить значение в Redis по ключу "${key}"`, error as Error);
      return null;
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** Атомарный инкремент счётчика с установкой TTL на первом попадании. Используется в RateLimitService. */
  async incrWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return count;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }
}
