import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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

  app.use(
    helmet({
      // Дефолтный CSP от Helmet блокирует инлайн-скрипты/стили — а именно на
      // них построена страница Swagger UI (единственный HTML, который отдаёт
      // это приложение). Остальные директивы (default-src 'self', object-src
      // 'none' и т.д.) остаются как есть.
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'", "'unsafe-inline'"],
          'style-src': ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('API авторизации')
    .setDescription(
      'Backend-модуль авторизации/регистрации: вход по никнейму и паролю, вход через ' +
        'Telegram (deep-link), привязка Telegram к существующему аккаунту, JWT-сессии ' +
        '(access + refresh с ротацией), пополнение баланса. Подробности флоу — в README.md.\n\n' +
        'Access-токен передаётся в httpOnly cookie `access_token` (её ставят /auth/login, ' +
        '/auth/telegram/confirm и /auth/refresh) — из браузера её нельзя ни увидеть, ни ' +
        'подставить руками в это Swagger UI. Чтобы опробовать защищённые эндпоинты прямо ' +
        'здесь, нажмите Authorize и вставьте access-токен как Bearer — сервер принимает его ' +
        'в заголовке `Authorization` точно так же, как и из cookie.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access-токен (см. описание выше). В браузере используется httpOnly cookie, а не этот заголовок.',
      },
      'access-token',
    )
    .addTag('auth', 'Регистрация и вход по никнейму/паролю, refresh/logout')
    .addTag('users', 'Профиль текущего пользователя')
    .addTag('telegram-auth', 'Вход и привязка аккаунта через Telegram (deep-link флоу)')
    .addTag('telegram-webhook', 'Вебхук Telegram — вызывается только серверами Telegram, не руками')
    .addTag('balance', 'Баланс пользователя')
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument, {
    customSiteTitle: 'API авторизации — документация',
    swaggerOptions: { persistAuthorization: true },
  });

  const port = configService.get('port', { infer: true });
  await app.listen(port);
}

void bootstrap();
