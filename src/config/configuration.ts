/**
 * Типизированная конфигурация приложения. ConfigService используется
 * с generic-параметром (см. ConfigModule.forRoot({ isGlobal: true })),
 * поэтому во всех сервисах конфиг читается через один и тот же shape.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  isProduction: boolean;
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  telegram: {
    botToken: string;
    botUsername: string;
    webhookSecret: string;
  };
  frontendUrl: string;
  corsOrigins: string[];
  cookieDomain?: string;
}

export default (): AppConfig => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  return {
    nodeEnv,
    port: parseInt(process.env.PORT ?? '3000', 10),
    isProduction: nodeEnv === 'production',
    database: {
      url: process.env.DATABASE_URL as string,
    },
    redis: {
      url: process.env.REDIS_URL as string,
    },
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET as string,
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
      refreshSecret: process.env.JWT_REFRESH_SECRET as string,
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN as string,
      botUsername: (process.env.TELEGRAM_BOT_USERNAME as string)?.replace(/^@/, ''),
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET as string,
    },
    frontendUrl: process.env.FRONTEND_URL as string,
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  };
};
