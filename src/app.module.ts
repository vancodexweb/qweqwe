import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { BalanceModule } from './balance/balance.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { TelegramAuthModule } from './telegram/telegram-auth.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),

    // Глобальный IP-based rate limit "по умолчанию" на все эндпоинты (защита от
    // общего злоупотребления API). Более строгие лимиты на конкретные чувствительные
    // эндпоинты (login/register/telegram-link) задаются локально через @Throttle(...),
    // а лимит по nickname/userId — отдельно через RateLimitService (см. RedisModule).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),

    PrismaModule,
    RedisModule,
    AuditLogModule,
    UsersModule,
    AuthModule,
    TelegramAuthModule,
    BalanceModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
