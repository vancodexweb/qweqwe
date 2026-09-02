import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppConfig } from '../config/configuration';
import { RateLimitService } from './rate-limit.service';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const redisUrl = configService.get('redis.url', { infer: true });
        return new Redis(redisUrl, {
          // Экспоненциальный backoff на переподключение — Redis может быть
          // временно недоступен во время старта docker-compose.
          retryStrategy: (attempt: number) => Math.min(attempt * 200, 5000),
          maxRetriesPerRequest: 3,
        });
      },
    },
    RedisService,
    RateLimitService,
  ],
  exports: [RedisService, RateLimitService],
})
export class RedisModule {}
