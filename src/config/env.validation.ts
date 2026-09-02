import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Схема переменных окружения. Валидируется один раз при старте приложения
 * (см. ConfigModule.forRoot({ validate })) — так конфигурационные ошибки
 * (забытый секрет, некорректный URL) роняют приложение сразу, а не в проде
 * посреди обработки запроса пользователя.
 */
class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string = 'development';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  @IsString()
  @MinLength(32, {
    message: 'JWT_ACCESS_SECRET должен быть не короче 32 символов',
  })
  JWT_ACCESS_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsString()
  @MinLength(32, {
    message: 'JWT_REFRESH_SECRET должен быть не короче 32 символов',
  })
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsString()
  @IsNotEmpty()
  TELEGRAM_BOT_TOKEN!: string;

  @IsString()
  @IsNotEmpty()
  TELEGRAM_BOT_USERNAME!: string;

  @IsString()
  @MinLength(16, {
    message: 'TELEGRAM_WEBHOOK_SECRET должен быть не короче 16 символов',
  })
  TELEGRAM_WEBHOOK_SECRET!: string;

  @IsUrl({ require_tld: false })
  FRONTEND_URL!: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS: string = '';

  @IsOptional()
  @IsString()
  COOKIE_DOMAIN?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((error) => Object.values(error.constraints ?? {}).join('; '))
      .join('\n');
    throw new Error(`Некорректная конфигурация окружения (.env):\n${messages}`);
  }

  return validatedConfig;
}
