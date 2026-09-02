import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get<ConfigService<AppConfig, true>>(ConfigService);

  // За reverse-proxy (nginx/traefik и т.п., типичная схема в Docker/production)
  // Express должен доверять заголовку X-Forwarded-For, иначе req.ip всегда будет
  // адресом прокси — это сломает IP-based rate limiting и исказит audit log.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: configService.get('corsOrigins', { infer: true }),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Запрос с лишними полями в теле (например, попытка передать isTelegramLinked
      // или telegramId напрямую в DTO) отклоняется целиком, а не молча обрезается —
      // так это заметнее в логах и однозначно для клиента.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = configService.get('port', { infer: true });
  await app.listen(port);
}

void bootstrap();
