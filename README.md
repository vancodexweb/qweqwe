# Backend-модуль авторизации/регистрации

Backend на NestJS для веб-приложения с двумя независимыми способами попасть в аккаунт: через **Telegram-бота** (deep-link, без формы регистрации) и через классическую пару **никнейм + пароль**. Стек: NestJS 11, Prisma ORM, PostgreSQL, Redis, Telegraf, Docker/docker-compose.

## Содержание

1. [Общее описание](#1-общее-описание)
2. [Архитектура и структура папок](#2-архитектура-и-структура-папок)
3. [Пошаговая настройка окружения](#3-пошаговая-настройка-окружения)
4. [Флоу авторизации](#4-флоу-авторизации)
5. [Эндпоинты API](#5-эндпоинты-api)
6. [Интеграция на фронтенде](#6-интеграция-на-фронтенде)
7. [Безопасность](#7-безопасность)
8. [Roadmap](#8-roadmap)

---

## 1. Общее описание

Система даёт пользователю два **независимых** способа получить сессию (пару JWT-токенов):

1. **Через Telegram** — пользователь нажимает «Войти через Telegram», переходит в бота по deep-link'у и подтверждает вход одной кнопкой. Отдельной регистрации не требует: если это первый вход этого Telegram-аккаунта, пользователь создаётся автоматически.
2. **Через никнейм и пароль** — классическая связка `POST /auth/register` → `POST /auth/login`. Требует явной регистрации; при попытке войти под несуществующим никнеймом никто ничего автоматически не создаёт (в отличие от Telegram-пути) — пользователь получает понятную ошибку «сначала зарегистрируйтесь».

Оба способа входа могут сходиться в одном аккаунте: nickname/password-пользователь может дополнительно привязать Telegram (`POST /auth/telegram/link/start`), после чего у него будет два равнозначных способа входа в один и тот же аккаунт.

**Зачем привязка Telegram обязательна для пополнения баланса.** Telegram-аккаунт — самый дешёвый доступный этому проекту способ хоть как-то верифицировать, что за аккаунтом стоит реальный человек, а не бот с одноразовой парой никнейм/пароль (регистрация которых ничем не ограничена, кроме rate-limit). Поэтому финансовые операции (пополнение баланса) требуют, чтобы у аккаунта был привязан Telegram: `isTelegramLinked === true`. Пользователю, у которого этого нет, эндпоинт пополнения возвращает `403 { code: "TELEGRAM_LINK_REQUIRED" }` — это единственное ограничение, всё остальное в системе доступно сразу после регистрации любым из двух способов.

---

## 2. Архитектура и структура папок

```
.
├── Dockerfile                      # multi-stage сборка (builder + production)
├── docker-compose.yml              # app + postgres + redis — локальная разработка, одна команда
├── docker-compose.prod.yml         # то же + nginx (HTTPS) — production на vancodex.tech
├── nginx/
│   └── user_conf.d/
│       └── vancodex.tech.conf      # конфиг nginx для docker-compose.prod.yml (домен вшит)
├── docker/
│   └── entrypoint.sh               # prisma migrate deploy перед стартом контейнера
├── .env.example                    # шаблон переменных окружения
├── prisma/
│   ├── schema.prisma                # модели User / RefreshToken / AuditLog
│   └── migrations/                  # SQL-миграции (применяются migrate deploy)
└── src/
    ├── main.ts                      # bootstrap: helmet, cookie-parser, CORS, ValidationPipe
    ├── app.module.ts                 # сборка всех модулей, глобальные guard/filter
    │
    ├── config/
    │   ├── configuration.ts          # типизированный конфиг (ConfigService<AppConfig>)
    │   └── env.validation.ts         # class-validator схема .env, падает при старте, если что-то не так
    │
    ├── prisma/                       # PrismaModule — глобальная обёртка над PrismaClient
    ├── redis/                        # RedisModule — обёртка над ioredis + RateLimitService
    │
    ├── audit-log/                    # AuditLogModule — запись действий в таблицу audit_logs
    │
    ├── users/
    │   ├── users.service.ts          # findById/findByNickname/findByTelegramId/create*/linkTelegram
    │   ├── users.controller.ts       # GET /users/me
    │   └── types/safe-user.type.ts   # User без passwordHash, с telegramId/balance как string
    │
    ├── auth/                         # nickname/password + управление JWT-парой
    │   ├── auth.controller.ts        # /auth/register, /auth/login, /auth/refresh, /auth/logout
    │   ├── auth.service.ts           # хэширование паролей (argon2id), rate-limit по nickname
    │   ├── token.service.ts          # выпуск/ротация/отзыв JWT-пары, refresh-токены в БД
    │   ├── cookie.util.ts            # httpOnly-cookie для access/refresh токенов
    │   ├── strategies/                # JwtStrategy (access), JwtRefreshStrategy (refresh)
    │   ├── dto/                       # RegisterDto, LoginDto (class-validator)
    │   └── types/jwt-payload.interface.ts
    │
    ├── telegram/                     # Telegram deep-link флоу + вебхук + привязка
    │   ├── telegram-bot.service.ts   # обёртка над Telegraf (без бизнес-логики, без launch())
    │   ├── telegram-auth.service.ts  # обработка /start, confirm/status/link/login-start
    │   ├── telegram-code.service.ts  # состояние одноразовых кодов в Redis
    │   ├── telegram-auth.controller.ts    # /auth/telegram/*
    │   ├── telegram-webhook.controller.ts # /telegram/webhook
    │   ├── guards/telegram-webhook-secret.guard.ts
    │   └── dto/                      # TelegramConfirmDto, TelegramStatusQueryDto
    │
    ├── balance/                      # финансовые эндпоинты
    │   ├── balance.controller.ts     # POST /balance/topup
    │   ├── balance.service.ts
    │   └── guards/telegram-linked.guard.ts   # 403 TELEGRAM_LINK_REQUIRED
    │
    └── common/                        # сквозные вещи без собственного NestJS-модуля
        ├── guards/                    # JwtAuthGuard, JwtRefreshGuard (см. ниже, почему не в AuthModule)
        ├── decorators/current-user.decorator.ts
        ├── filters/all-exceptions.filter.ts   # единый формат ошибок { code, message, ... }
        └── utils/                     # request-meta (ip/UA), duration (парсинг "15m"/"7d")
```

### Почему JwtAuthGuard/JwtRefreshGuard лежат в `common/`, а не в `auth/`

`AuthModule` импортирует `UsersModule` (нужен `UsersService` в `JwtStrategy`). Если бы `UsersModule` в ответ импортировал `AuthModule` (чтобы получить guard для `GET /users/me`), получился бы циклический импорт модулей. Guard'ы не имеют собственных зависимостей и полагаются на то, что Passport-стратегия зарегистрирована в общем процессе — поэтому они вынесены в `common/guards` и используются напрямую через `@UseGuards(...)` в любом модуле (`users`, `balance`, `telegram`) без обратной зависимости от `AuthModule`.

### Prisma-модель

```
User
 ├─ id, nickname?, passwordHash?           — nickname/password-вход
 ├─ telegramId?, telegramUsername?         — Telegram-вход (telegramId: BigInt, уникален)
 ├─ isTelegramLinked (default false)
 ├─ balance (Decimal, default 0)
 └─ createdAt / updatedAt

RefreshToken                                AuditLog
 ├─ id (= jti из JWT)                        ├─ id
 ├─ userId → User (onDelete: Cascade)         ├─ userId? → User (onDelete: SetNull)
 ├─ tokenHash (SHA-256, unique)               ├─ action, ip?, userAgent?
 ├─ revoked, expiresAt                        ├─ metadata (Json?)
 └─ ip?, userAgent?, createdAt                └─ createdAt
```

---

## 3. Пошаговая настройка окружения

### 3.1. Получение `TELEGRAM_BOT_TOKEN` у @BotFather

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram.
2. Отправьте `/newbot`, задайте имя и username (должен заканчиваться на `bot`, например `my_auth_bot`).
3. BotFather пришлёт токен вида `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` — это `TELEGRAM_BOT_TOKEN`.
4. Username бота без `@` — это `TELEGRAM_BOT_USERNAME` (в примере: `my_auth_bot`).
5. Рекомендуется сразу отключить возможность добавлять бота в группы: `/setjoingroups` → `Disable` (это чисто auth-бот, ему незачем быть в группах).

### 3.2. `TELEGRAM_WEBHOOK_SECRET` и регистрация вебхука

`TELEGRAM_WEBHOOK_SECRET` — произвольная строка не короче 16 символов, которую знаете только вы и Telegram. Сгенерировать:

```bash
openssl rand -hex 32
```

Приложение **не** регистрирует вебхук само при старте (в dev-окружении у вас обычно ещё нет публичного HTTPS-адреса). Регистрация — ручной шаг после того, как backend доступен извне по HTTPS (см. [чеклист перед продакшеном](#77-чеклист-перед-продакшеном)):

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/telegram/webhook",
    "secret_token": "<значение TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message"]
  }'
```

Проверить, что вебхук зарегистрирован корректно:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Снять вебхук (например, чтобы локально тестировать бота через `getUpdates`/сторонний polling-скрипт):

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook"
```

> Локальная разработка без публичного HTTPS: используйте туннель (ngrok, Cloudflare Tunnel и т.п.) и регистрируйте вебхук на его адрес. Приложение само по себе ничего не знает про способ туннелирования — ему достаточно, что запросы приходят на `POST /telegram/webhook` с правильным secret-заголовком.

### 3.3. Переменные окружения (`.env`)

Скопируйте `.env.example` в `.env` и заполните:

| Переменная | Назначение |
|---|---|
| `NODE_ENV` | `development` \| `production`. В `production` включается флаг `Secure` у cookie — без HTTPS браузер такие cookie принимать не будет. |
| `PORT` | Порт, на котором слушает NestJS. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Учётные данные Postgres — используются docker-compose при первом создании контейнера БД. |
| `DATABASE_URL` | Полная строка подключения Prisma. Актуальна для запуска **не через Docker** (например, `npm run start:dev` на хосте) — там Postgres слушает на `localhost`, т.к. порт 5432 контейнера проброшен наружу. Внутри docker-compose (сервис `app`) значение автоматически переопределяется на хост `postgres` — см. `environment:` в `docker-compose.yml`. |
| `REDIS_URL` | Аналогично `DATABASE_URL`: для контейнера `app` хост переопределяется на `redis`. |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Секреты для подписи JWT. Не короче 32 символов, обязательно разные. Генерировать: `openssl rand -base64 48`. |
| `JWT_ACCESS_EXPIRES_IN` | Время жизни access-токена. По умолчанию `15m` (допустимо 15–30 мин по ТЗ). |
| `JWT_REFRESH_EXPIRES_IN` | Время жизни refresh-токена. По умолчанию `7d`. |
| `TELEGRAM_BOT_TOKEN` | Токен от @BotFather. |
| `TELEGRAM_BOT_USERNAME` | Username бота без `@`. |
| `TELEGRAM_WEBHOOK_SECRET` | Секрет вебхука, см. 3.2. |
| `FRONTEND_URL` | Базовый URL фронтенда — используется при построении ссылки в inline-кнопке бота (`{FRONTEND_URL}/auth/telegram/confirm?code=...`). |
| `CORS_ORIGINS` | Список разрешённых origin через запятую. Без `*` в проде (см. раздел «Безопасность»). |
| `COOKIE_DOMAIN` | Домен для cookie. Пусто — браузер сам подставит хост запроса (ок для локальной разработки). |

Приложение **не запустится**, если обязательная переменная отсутствует или не проходит валидацию (см. `src/config/env.validation.ts`) — это намеренно: лучше упасть на старте, чем словить непонятную ошибку посреди обработки запроса пользователя.

### 3.4. Запуск

```bash
cp .env.example .env
# заполните .env своими значениями

docker-compose up --build
```

Это одной командой поднимет Postgres, Redis и само приложение. Перед стартом NestJS-процесса `docker/entrypoint.sh` автоматически выполняет `prisma migrate deploy` — миграции применяются сами, руками ничего катить не нужно.

Проверить, что всё поднялось:

```bash
curl http://localhost:3000/auth/telegram/login/start -X POST
# {"authCode":"...", "telegramDeepLink":"https://t.me/...", ...}
```

**Swagger-документация** доступна прямо в приложении по адресу `/docs` (например `http://localhost:3000/docs`, на продакшене — `https://vancodex.tech/docs`) — интерактивная, на русском, со всеми эндпоинтами, телами запросов и примерами ответов, включая коды ошибок. Через кнопку **Authorize** можно вставить access-токен (получить его — залогиниться через `/auth/login`, скопировать значение cookie `access_token` из devtools браузера) и опробовать защищённые эндпоинты прямо из интерфейса. Машиночитаемая OpenAPI-схема — `/docs-json`.

Локальная разработка без Docker (Postgres/Redis всё равно проще поднять через `docker-compose up postgres redis`, а сам Nest-процесс — напрямую для watch-режима):

```bash
docker-compose up -d postgres redis
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run start:dev
```

### 3.5. Production-развёртывание на vancodex.tech (nginx + автоматический HTTPS)

`docker-compose.yml` рассчитан на локальную разработку — приложение слушает обычный HTTP на порту 3000. Для продакшена в репозитории есть отдельный, самостоятельный файл **`docker-compose.prod.yml`**: то же самое (`postgres` + `redis` + `app`), плюс сервис `nginx` — образ [`jonasal/nginx-certbot`](https://github.com/JonasAlfredsson/docker-nginx-certbot), который сам получает и продлевает HTTPS-сертификат Let's Encrypt. Домен `vancodex.tech` уже прописан напрямую в конфиге — `nginx/user_conf.d/vancodex.tech.conf` (nginx-образ сам находит там `server_name` и запрашивает сертификат именно под него, никаких дополнительных переменных для этого не нужно). Поднимается **одной командой**, руками certbot нигде не вызывается.

Почему это отдельный файл, а не тот же `docker-compose.yml`: продакшен-версия занимает порты 80/443 (нужны Let's Encrypt и самому HTTPS) и не публикует порт приложения (3000) и порты БД/Redis наружу вообще — только nginx доступен из интернета. Смешивать это с локальной разработкой избыточно.

**Перед первым запуском (вне Docker, один раз):**

1. **DNS.** A-запись `vancodex.tech` должна уже указывать на IP этого сервера — вы говорите, что это уже сделано, но на всякий случай проверить: `dig +short vancodex.tech` должен вернуть IP именно этого сервера.
2. **Firewall / security group.** На сервере должны быть открыты порты **80** и **443** для входящих подключений из интернета (80 нужен для ACME HTTP-01 challenge при получении сертификата, 443 — сам HTTPS). Порты 5432/6379/3000 наоборот — наружу открывать не нужно, `docker-compose.prod.yml` их и не публикует.
3. **`.env`.** Скопируйте `.env.example` в `.env` и заполните: секреты (`JWT_*_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, пароль Postgres), `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME`, `CERTBOT_EMAIL` (ваша почта — Let's Encrypt пришлёт туда, если с сертификатом что-то не так), а также:
   ```bash
   NODE_ENV=production
   FRONTEND_URL=https://vancodex.tech          # или адрес фронтенда, если он отдельно
   CORS_ORIGINS=https://vancodex.tech           # без "*"
   ```
   `NODE_ENV=production` — обязательно, иначе cookie с токенами не получат флаг `Secure`.

**Запуск — вот та самая одна команда:**

```bash
docker-compose -f docker-compose.prod.yml up --build -d
```

Она поднимет Postgres и Redis, дождётся их healthcheck, соберёт и запустит `app` (миграции накатятся сами через entrypoint), поднимет `nginx`, который автоматически получит сертификат Let's Encrypt для `vancodex.tech` и начнёт проксировать `https://vancodex.tech` → `app:3000`. Обычно это занимает 30-60 секунд с момента старта до рабочего HTTPS.

**Проверка, что HTTPS поднялся:**

```bash
curl -i https://vancodex.tech/auth/telegram/login/start -X POST
```

Если вместо ответа — таймаут или ошибка сертификата: почти всегда это nginx ещё не успел получить сертификат (DNS ещё не разошёлся, порт 80 закрыт файрволом) — подождите ещё немного и проверьте логи:

```bash
docker-compose -f docker-compose.prod.yml logs -f nginx
```

**Дальше — регистрация вебхука** (тот же шаг, что в разделе 3.2, но теперь адрес уже настоящий):

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://vancodex.tech/telegram/webhook",
    "secret_token": "<значение TELEGRAM_WEBHOOK_SECRET из .env>",
    "allowed_updates": ["message"]
  }'
```

Проверить регистрацию (поле `"url"` должно совпасть, `"last_error_message"` — отсутствовать):

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

**Финальная сквозная проверка всего флоу** — сгенерируйте код `POST https://vancodex.tech/auth/telegram/login/start`, откройте вернувшуюся `telegramDeepLink`, нажмите Start — бот должен прислать сообщение с кнопкой «Подтвердить вход» в течение секунды-двух. Если бот молчит — проверьте логи приложения (`docker-compose -f docker-compose.prod.yml logs -f app`): скорее всего, `TELEGRAM_BOT_TOKEN` неверен, либо вебхук зарегистрирован на другой адрес.

Если позже понадобится накатить новую версию кода — `git pull && docker-compose -f docker-compose.prod.yml up --build -d` пересоберёт и перезапустит только то, что изменилось; `postgres`/`redis`/сертификат не теряются (именованные volume, включая `nginx_secrets` с сертификатом).

> Образ `nginx` закреплён на теге `:latest` сознательно — так `docker pull` гарантированно не упадёт на несуществующем теге при первом запуске. Когда всё заработает, для стабильности стоит зафиксировать версию — актуальный список на [Docker Hub](https://hub.docker.com/r/jonasal/nginx-certbot/tags).

---

## 4. Флоу авторизации

### 4.1. Никнейм + пароль

1. **Регистрация** — `POST /auth/register { nickname, password }`. Никнейм: 3–32 символа, только `[a-zA-Z0-9_]` (regex whitelist). Пароль: 8–128 символов. Пароль хэшируется через **argon2id** (см. раздел «Безопасность») и никогда не покидает backend в открытом виде. Эндпоинт **не** выдаёт токены — это осознанно отдельный шаг от логина (симметрично Telegram-флоу, где подтверждение тоже отделено от первого касания с ботом).
2. **Логин** — `POST /auth/login { nickname, password }`. При успехе выдаётся пара JWT (access + refresh) в httpOnly-cookie.
3. Логин под **несуществующим** никнеймом — `404 { code: "NICKNAME_NOT_REGISTERED" }`, аккаунт **не** создаётся автоматически (в отличие от Telegram-пути).

### 4.2. Вход через Telegram (deep-link + inline-кнопка)

Пошагово, с указанием, что происходит на бэке/фронте на каждом шаге:

| Шаг | Кто | Что происходит |
|---|---|---|
| 1 | Фронт | Пользователь жмёт «Войти через Telegram». Фронт вызывает `POST /auth/telegram/login/start`. |
| 2 | Бэк | Генерирует `authCode` (`crypto.randomUUID()`), сохраняет в Redis `auth:tg:code:{authCode} → { status: "pending", mode: "login", createdAt }`, TTL **5 минут**. Возвращает `authCode` + готовые ссылки на бота. |
| 3 | Фронт | Открывает `https://t.me/{TELEGRAM_BOT_USERNAME}?start={authCode}` (десктоп/веб) или `tg://resolve?domain={username}&start={authCode}` (мобильные — открывает нативное приложение напрямую, см. раздел 6). |
| 4 | Пользователь | Жмёт **Start** в Telegram. Апдейт приходит на `POST /telegram/webhook`. |
| 5 | Бэк | Guard проверяет `X-Telegram-Bot-Api-Secret-Token` (401, если неверен/отсутствует). Достаёт `authCode` из `ctx.startPayload` (Telegraf). Ищет код в Redis: если не найден/протух — бот отвечает «ссылка устарела»; если найден и `status: "pending"` — по `telegramId` из апдейта ищет `User`: **есть** → просто помечает код готовым для этого пользователя; **нет** → создаёт нового `User` (telegramId, telegramUsername, `isTelegramLinked: true`, `nickname`/`passwordHash` остаются `null`) — это и есть автоматическая регистрация через Telegram, без формы. |
| 6 | Бэк → Telegram | Бот отправляет сообщение с одной inline-кнопкой (URL-button) на `{FRONTEND_URL}/auth/telegram/confirm?code={authCode}`. |
| 7 | Пользователь | Жмёт кнопку в Telegram → открывается сайт с `code` в query-параметре. |
| 8 | Фронт | `POST /auth/telegram/confirm { code }`. |
| 9 | Бэк | Код должен быть в статусе `"ready"`. Если да — достаёт пользователя, выдаёт JWT-пару (httpOnly-cookie), **немедленно** переводит код в состояние `"used"` (короткоживущий tombstone, см. ниже) — повторное использование невозможно. |
| 10 | Фронт | Если код ещё `"pending"` (фронт постучался раньше, чем пользователь нажал Start в боте) — `confirm` вернёт `409 AUTH_CODE_PENDING`. Фронт поллит `GET /auth/telegram/status?code=...` с экспоненциальным бэкоффом, пока статус не станет `"ready"` (тогда зовёт `confirm`) либо код не протухнет. |

**Привязка Telegram к уже залогиненному nickname/password-аккаунту** использует тот же механизм с двумя отличиями:

- Старт — `POST /auth/telegram/link/start` (требует JWT). Redis-код дополнительно хранит `requestUserId` залогиненного пользователя, `mode: "link"`.
- На шаге 5 бэк **не создаёт** нового пользователя: если `telegramId` свободен — привязывает его к `requestUserId` (`telegramId`, `telegramUsername`, `isTelegramLinked = true`); если уже привязан к **другому** аккаунту — код переводится в `status: "error"` с `errorCode: "TELEGRAM_ALREADY_LINKED"`, пользователю в боте приходит понятное сообщение, привязка не происходит.
- На шаге 9 `confirm` для `mode: "link"` не логинит заново «с нуля» — токены всё равно перевыпускаются (это просто удобно фронту: один и тот же обработчик подтверждения для обоих режимов), но сама привязка (`telegramId` в БД) уже была проставлена на шаге 5, **строго** из Redis-кода, не из тела запроса.

### 4.3. Статусы Redis-кода

Ключ: `auth:tg:code:{authCode}`, значение — JSON, TTL плавает по описанным ниже правилам.

| Статус | Когда | TTL |
|---|---|---|
| `pending` | Код создан (`login/start` или `link/start`), Start в боте ещё не нажат. | 5 минут от создания. |
| `ready` | `/start` обработан, пользователь определён (создан/найден/привязан). | Остаток исходных 5 минут — **не продлевается** при переходе в `ready`. |
| `used` | `confirm` успешно выдал токены. Код-«надгробие» ещё ненадолго виден, чтобы повторный/задвоившийся запрос подтверждения получил внятный `409 AUTH_CODE_ALREADY_USED`, а не неотличимое от протухшего «код не найден». | 30 секунд, затем исчезает сам. |
| `error` | Конфликт при привязке (`TELEGRAM_ALREADY_LINKED`) или повреждённый код (`INVALID_LINK_CODE`). | Остаток исходных 5 минут. |
| *(ключ отсутствует)* | Код никогда не существовал, либо честно протух (5 минут вышло), либо давно `used` (прошло 30 секунд после использования). | — |

Со стороны API `GET /auth/telegram/status` в последнем случае возвращает `{ status: "expired" }` — с точки зрения клиента «протухший» и «никогда не существовавший» коды неотличимы намеренно (не даём атакующему подбором кодов понять, существовал ли когда-либо конкретный `authCode`).

---

## 5. Эндпоинты API

Формат ошибок everywhere единый:

```json
{ "statusCode": 404, "code": "NICKNAME_NOT_REGISTERED", "message": "...", "timestamp": "...", "path": "/auth/login" }
```

### `POST /auth/register`

JWT не нужен. Rate limit: 5 запросов/мин по IP.

Тело: `{ "nickname": "ivan_2000", "password": "correcthorsebatterystaple" }`

Успех — `201`:
```json
{ "user": { "id": "...", "nickname": "ivan_2000", "telegramId": null, "telegramUsername": null, "isTelegramLinked": false, "balance": "0", "createdAt": "...", "updatedAt": "..." } }
```

Ошибки: `400` (никнейм/пароль не проходят валидацию), `409 NICKNAME_TAKEN` (никнейм занят), `429` (rate limit).

### `POST /auth/login`

JWT не нужен. Rate limit: 10/мин по IP **и** 10/мин по nickname (см. «Безопасность»).

Тело: `{ "nickname": "ivan_2000", "password": "correcthorsebatterystaple" }`

Успех — `200`, тело `{ "user": {...} }`, плюс `Set-Cookie: access_token=...; refresh_token=...`.

Ошибки: `400`, `404 NICKNAME_NOT_REGISTERED` («сначала зарегистрируйтесь»), `401 INVALID_CREDENTIALS`, `429 RATE_LIMITED`.

### `POST /auth/refresh`

Требует валидный `refresh_token` в cookie (не Bearer-заголовок — refresh специально доступен только через httpOnly-cookie с `Path=/auth`). Тело не нужно.

Успех — `200 { "status": "ok" }`, refresh-токен **ротируется** — старый мгновенно становится недействителен, приходят новые `Set-Cookie`.

Ошибки: `401 REFRESH_TOKEN_INVALID` (подпись неверна/токен не найден в БД), `401 REFRESH_TOKEN_EXPIRED`, `401 REFRESH_TOKEN_REUSED` (кто-то предъявил уже провёрнутый токен — подозрение на угон сессии, **все** refresh-токены пользователя отозваны, нужен полный повторный логин).

### `POST /auth/logout`

Требует валидный `access_token` (JWT в cookie либо `Authorization: Bearer`). Отзывает refresh-токен, связанный с текущей cookie-сессией, очищает обе cookie.

Успех — `200 { "status": "ok" }`. Ошибки: `401 UNAUTHORIZED`.

### `GET /users/me`

Требует JWT. Возвращает текущего пользователя (без `passwordHash`). Единственный способ для SPA восстановить сессию по httpOnly-cookie при загрузке страницы.

Успех — `200`, тело — объект пользователя (как в `register`). Ошибки: `401 UNAUTHORIZED`.

### `POST /auth/telegram/login/start`

JWT не нужен.

Успех — `200`:
```json
{
  "authCode": "6f2fb95d-5b88-4336-b4fd-1511dd855aa0",
  "telegramDeepLink": "https://t.me/my_auth_bot?start=6f2fb95d-...",
  "telegramDeepLinkApp": "tg://resolve?domain=my_auth_bot&start=6f2fb95d-...",
  "expiresInSeconds": 300
}
```

### `POST /auth/telegram/link/start`

Требует JWT. Rate limit: 5/мин по IP **и** 5/мин по userId.

Успех — `200`, тело как у `login/start`. Ошибки: `401 UNAUTHORIZED`, `429 RATE_LIMITED`.

### `GET /auth/telegram/status?code=...`

JWT не нужен. Без побочных эффектов — можно поллить сколько угодно, код не расходуется.

Успех — `200 { "status": "pending" | "ready" | "used" | "error" | "expired", "errorCode"?: string }`.

Ошибки: `400` (code не является UUID).

### `POST /auth/telegram/confirm`

JWT не нужен (для `mode: "link"` личность подтверждающего берётся из Redis-кода, привязанного к `requestUserId` на шаге `link/start`, а не из cookie текущего запроса — см. раздел 4.2).

Тело: `{ "code": "6f2fb95d-..." }`

Успех — `200`:
```json
{ "mode": "login", "user": { "id": "...", "telegramId": "987654321", "isTelegramLinked": true, "balance": "0", ... } }
```
(плюс `Set-Cookie` с новой JWT-парой). `mode` — `"login"` или `"link"`, в зависимости от того, каким способом был создан код.

Ошибки:
- `400` — `code` не UUID.
- `404 AUTH_CODE_INVALID` — код не найден (протух либо никогда не существовал).
- `409 AUTH_CODE_PENDING` — Start в боте ещё не нажат.
- `409 AUTH_CODE_ALREADY_USED` — код уже был использован ранее.
- `409 TELEGRAM_ALREADY_LINKED` / `409 INVALID_LINK_CODE` — ошибка, зафиксированная на шаге привязки (см. 4.2).

### `POST /telegram/webhook`

Только для серверов Telegram. Обязателен заголовок `X-Telegram-Bot-Api-Secret-Token`, совпадающий с `TELEGRAM_WEBHOOK_SECRET`.

Всегда отвечает `200 { "ok": true }` — даже если обработка апдейта внутри упала (см. «Безопасность»/комментарии в коде: так рекомендует сам Telegram, чтобы не плодить бесконечные повторные доставки одного и того же апдейта). Единственная ошибка, которую этот эндпоинт может вернуть, — `401 WEBHOOK_UNAUTHORIZED` при неверном/отсутствующем secret-заголовке, **до** какой-либо обработки тела.

### `POST /balance/topup`

Требует JWT **и** `isTelegramLinked === true`.

Тело: `{ "amount": 100.50 }` (положительное число, максимум 2 знака после запятой).

Успех — `200 { "user": {...} }` (с обновлённым `balance`).

Ошибки: `401 UNAUTHORIZED`, `403 TELEGRAM_LINK_REQUIRED` («Для пополнения баланса необходимо привязать Telegram-аккаунт»), `400` (некорректная сумма).

---

## 6. Интеграция на фронтенде

Примеры на TypeScript, без привязки к конкретному фреймворку (React использован только в финальном примере компонента). Предполагается `fetch`; всё то же самое тривиально переносится на `axios`.

### 6.1. Общий helper и типы

```typescript
// api/client.ts
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export interface SafeUser {
  id: string;
  nickname: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  isTelegramLinked: boolean;
  balance: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string | string[];
}

export class ApiError extends Error {
  constructor(public body: ApiErrorBody) {
    super(Array.isArray(body.message) ? body.message.join('; ') : body.message);
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    // Обязательно: без этого браузер не будет ни отправлять, ни принимать
    // httpOnly-cookie с токенами при кросс-origin запросах (frontend и backend
    // на разных портах/доменах — обычная ситуация даже в dev).
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (!res.ok) {
    throw new ApiError(await res.json());
  }

  // 204/логаут иногда без тела — но у нас все ответы JSON
  return res.json();
}
```

### 6.2. Форма регистрации/логина

```typescript
// api/auth.ts
import { apiFetch, ApiError, type SafeUser } from './client';

export function register(nickname: string, password: string) {
  return apiFetch<{ user: SafeUser }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ nickname, password }),
  });
}

export function login(nickname: string, password: string) {
  return apiFetch<{ user: SafeUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ nickname, password }),
  });
}

export function logout() {
  return apiFetch<{ status: 'ok' }>('/auth/logout', { method: 'POST' });
}

export function fetchMe() {
  return apiFetch<SafeUser>('/users/me');
}
```

Обработка ошибок валидации (class-validator присылает `message` массивом строк, если полей с ошибками несколько):

```typescript
async function handleRegisterSubmit(nickname: string, password: string) {
  try {
    const { user } = await register(nickname, password);
    console.log('Зарегистрирован:', user.id);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.body.code === 'NICKNAME_TAKEN') {
        showFieldError('nickname', 'Этот никнейм уже занят');
      } else if (e.body.code === 'RATE_LIMITED') {
        showFormError('Слишком много попыток, попробуйте через минуту');
      } else if (Array.isArray(e.body.message)) {
        // ошибки валидации DTO — по одной строке на каждое несоответствие
        showFormError(e.body.message.join('\n'));
      } else {
        showFormError(e.body.message);
      }
    }
  }
}
```

### 6.3. Кнопка «Войти через Telegram»

Определение мобильного устройства и выбор нужной ссылки (`tg://` открывает нативное приложение напрямую и работает надёжнее на мобильных; на десктопе `tg://` может не быть зарегистрирован как протокол в браузере, поэтому там — `https://t.me/...`, которая сама разрулит переход в приложение или Telegram Web):

```typescript
// telegram-login.ts
import { apiFetch, ApiError, type SafeUser } from './client';

export interface TelegramStartResponse {
  authCode: string;
  telegramDeepLink: string;
  telegramDeepLinkApp: string;
  expiresInSeconds: number;
}

export type TelegramCodeStatus = 'pending' | 'ready' | 'used' | 'error' | 'expired';

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function openTelegramBot(resp: TelegramStartResponse): void {
  const url = isMobileDevice() ? resp.telegramDeepLinkApp : resp.telegramDeepLink;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function startTelegramLogin() {
  return apiFetch<TelegramStartResponse>('/auth/telegram/login/start', { method: 'POST' });
}

export function startTelegramLink() {
  // Требует, чтобы пользователь уже был залогинен (JWT-cookie отправится автоматически).
  return apiFetch<TelegramStartResponse>('/auth/telegram/link/start', { method: 'POST' });
}

export function confirmTelegramCode(code: string) {
  return apiFetch<{ mode: 'login' | 'link'; user: SafeUser }>('/auth/telegram/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/**
 * Поллинг статуса кода с экспоненциальным бэкоффом (1s → 1.5s → 2.25s → ... , потолок 5s).
 * Останавливается сам, когда код перестаёт быть pending, либо по AbortSignal.
 */
export async function pollTelegramStatus(
  code: string,
  handlers: {
    onReady: () => void;
    onExpired: () => void;
    onError: (errorCode: string) => void;
  },
  signal: AbortSignal,
): Promise<void> {
  const MAX_DELAY_MS = 5000;
  let delay = 1000;

  while (!signal.aborted) {
    let status: TelegramCodeStatus;
    let errorCode: string | undefined;

    try {
      const res = await apiFetch<{ status: TelegramCodeStatus; errorCode?: string }>(
        `/auth/telegram/status?code=${encodeURIComponent(code)}`,
      );
      status = res.status;
      errorCode = res.errorCode;
    } catch {
      // Сетевая ошибка при поллинге — не считаем фатальной, пробуем ещё раз после паузы.
      await sleep(delay, signal);
      delay = Math.min(delay * 1.5, MAX_DELAY_MS);
      continue;
    }

    if (status === 'ready') {
      handlers.onReady();
      return;
    }
    if (status === 'expired') {
      handlers.onExpired();
      return;
    }
    if (status === 'error' || status === 'used') {
      handlers.onError(errorCode ?? status);
      return;
    }

    await sleep(delay, signal);
    delay = Math.min(delay * 1.5, MAX_DELAY_MS);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  });
}
```

**Обработка протухшего кода и перегенерация** — если `onExpired`/`onError` сработали, просто вызовите `startTelegramLogin()` заново (новый `authCode`) и откройте бота повторно — именно так это сделано в компоненте ниже.

### 6.4. Хранение JWT

**Рекомендуемый вариант (и то, что реализовано в этом backend по умолчанию)** — httpOnly-cookie. Токен физически недоступен из JavaScript (`document.cookie` его не видит), поэтому классический XSS (внедрённый `<script>`) не может его прочитать и вынести на сторону атакующего — это несравнимо безопаснее, чем `localStorage`/`sessionStorage`.

Если по какой-то причине вместо cookie используется **`localStorage`** (например, при полностью раздельных доменах фронта/бэка без общего родительского домена и без готовности идти на `SameSite=None`) — явно проговорите себе эти риски:
- Любой успешный XSS на странице получает токен целиком и может использовать его откуда угодно вплоть до истечения срока действия.
- Токен переживёт закрытие вкладки/браузера, что увеличивает окно атаки по сравнению с `sessionStorage`.
- Нет `Secure`/`SameSite` — вы теряете эти уровни защиты полностью, их придётся эмулировать вручную (короткий TTL access-токена, привязка refresh к User-Agent/IP и т.п. — паллиатив, не полноценная замена).

Если всё же localStorage — access-токен нужно руками добавлять в `Authorization: Bearer <token>` (backend это поддерживает, `JwtStrategy` проверяет и cookie, и заголовок), а `refresh` эндпоинт продолжит работать только через cookie (сознательное ограничение: refresh-токен, самый чувствительный из двух, cookie-only).

**Важный нюанс cross-origin cookie.** `SameSite=Strict` (используется в этом backend) исправно работает, если фронтенд и бэкенд — на одном и том же **сайте** (eTLD+1): например `app.example.com` и `api.example.com` — это один "site", cookie будет отправляться. Если же фронт и бэк на **разных** регистрируемых доменах (`my-frontend.vercel.app` и `my-api.railway.app`) — `SameSite=Strict`/`Lax` не даст cookie уйти при кросс-origin `fetch()`, и вся cookie-схема тихо перестанет работать (в ответ будет приходить `Set-Cookie`, но браузер не будет её ни хранить в кросс-origin контексте для последующих запросов, ни отправлять обратно). Варианты: (а) — рекомендуется — развести фронт и бэк по поддоменам одного домена и/или проксировать API через тот же домен, что и фронт (nginx/Next.js rewrites и т.п.); (б) осознанно перейти на `SameSite=None; Secure` (требует HTTPS всегда, ослабляет защиту от CSRF — компенсируйте строгим CORS-whitelist и тем, что все чувствительные операции и так требуют валидный токен).

### 6.5. Глобальная обработка `403 TELEGRAM_LINK_REQUIRED` (axios-интерцептор)

```typescript
import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const code = error.response?.data?.code;

    if (error.response?.status === 403 && code === 'TELEGRAM_LINK_REQUIRED') {
      // Глобальное событие вместо прямого импорта store/UI-компонента —
      // интерцептор не должен знать о конкретной реализации баннера.
      window.dispatchEvent(new CustomEvent('telegram-link-required'));
    }

    return Promise.reject(error);
  },
);
```

```typescript
// где-то в корне приложения (один раз)
window.addEventListener('telegram-link-required', () => {
  showBanner({
    text: 'Привяжите Telegram, чтобы пополнять баланс',
    action: { label: 'Привязать', onClick: () => navigate('/settings/telegram') },
  });
});
```

### 6.6. React-компонент полного цикла: клик → поллинг → редирект в личный кабинет

```tsx
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { openTelegramBot, startTelegramLogin, pollTelegramStatus, confirmTelegramCode } from './telegram-login';

type ViewState = 'idle' | 'waiting' | 'expired' | 'error';

export function TelegramLoginButton() {
  const [state, setState] = useState<ViewState>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  const startFlow = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState('waiting');
    setErrorText(null);

    try {
      const startResp = await startTelegramLogin();
      openTelegramBot(startResp);

      await pollTelegramStatus(
        startResp.authCode,
        {
          onReady: async () => {
            await confirmTelegramCode(startResp.authCode);
            navigate('/dashboard');
          },
          onExpired: () => setState('expired'),
          onError: (code) => {
            setState('error');
            setErrorText(code === 'TELEGRAM_ALREADY_LINKED'
              ? 'Этот Telegram-аккаунт уже привязан к другому пользователю'
              : 'Не удалось подтвердить вход через Telegram');
          },
        },
        controller.signal,
      );
    } catch {
      setState('error');
      setErrorText('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
    }
  }, [navigate]);

  return (
    <div>
      <button onClick={startFlow} disabled={state === 'waiting'}>
        {state === 'waiting' ? 'Ожидание подтверждения в Telegram…' : 'Войти через Telegram'}
      </button>

      {state === 'expired' && (
        <p>
          Код истёк. <button onClick={startFlow}>Попробовать снова</button>
        </p>
      )}

      {state === 'error' && (
        <p>
          {errorText} <button onClick={startFlow}>Попробовать снова</button>
        </p>
      )}
    </div>
  );
}
```

---

## 7. Безопасность

### 7.1. Вебхук Telegram

- `POST /telegram/webhook` защищён `TelegramWebhookSecretGuard`: без корректного заголовка `X-Telegram-Bot-Api-Secret-Token` запрос отклоняется `401` **до** передачи тела в Telegraf. Неудачные попытки пишутся в `AuditLog` (действие `telegram_webhook_unauthorized`) без самого значения секрета.
- Итоговый URL вебхука нигде в коде/логах не фигурирует (secret передаётся только в заголовке при `setWebhook`, конфигурация — через `.env`, не через аргументы командной строки/URL).
- Обработчик всегда отвечает `200`, даже если внутренняя обработка апдейта упала (ошибка уходит в логи) — иначе Telegram будет бесконечно повторно доставлять один и тот же апдейт при любом транзиентном сбое.

### 7.2. Rate limiting

Два независимых слоя:

1. **`@nestjs/throttler`**, IP-based, глобальный default 100 запросов/мин на все эндпоинты + точечные более строгие лимиты через `@Throttle(...)`: `/auth/register` — 5/мин, `/auth/login` — 10/мин, `/auth/telegram/link/start` — 5/мин.
2. **`RateLimitService`** (`src/redis/rate-limit.service.ts`) поверх Redis (`INCR` + `EXPIRE`) — лимит **по бизнес-ключу**, а не по IP: 10 попыток логина/мин **на nickname** (защита конкретного аккаунта от распределённого брутфорса с разных IP) и 5 попыток/мин **на userId** для `link/start` (защита от спама кодами привязки одним и тем же аккаунтом через разные IP/прокси).

При превышении любого лимита — `429`, заголовок `Retry-After` (секунды), для логина/линка — событие в `AuditLog`.

> Из коробки throttler использует in-memory storage — этого достаточно для одного инстанса приложения. При горизонтальном масштабировании (несколько реплик `app`) стоит подключить Redis-backed storage для `@nestjs/throttler` (см. Roadmap) — иначе у каждой реплики будет свой независимый счётчик.

### 7.3. Одноразовость Telegram-кодов

- Код — `crypto.randomUUID()`, TTL 5 минут с момента создания (не продлевается при переходе `pending → ready`).
- Немедленно после успешного `confirm` код переводится в состояние `used` (короткоживущий tombstone на 30 секунд, затем полностью исчезает из Redis) — повторно выдать токены по нему невозможно, повторный `confirm` получает `409 AUTH_CODE_ALREADY_USED` вместо неотличимого от валидного успеха.
- Попытки подтвердить уже использованный код пишутся в `AuditLog` (`telegram_auth_code_reuse_attempt`).

### 7.4. `telegramId` и `isTelegramLinked` — только через подтверждённый Redis-код

- Ни один DTO в приложении (`RegisterDto`, `TopUpDto`, DTO логина и т.д.) не содержит полей `telegramId`/`isTelegramLinked`/`telegramUsername`.
- Глобальный `ValidationPipe` в `main.ts` включён с `whitelist: true, forbidNonWhitelisted: true` — если клиент всё же пришлёт лишнее поле в теле запроса (например, попытается впихнуть `isTelegramLinked: true` в `POST /auth/register`), запрос будет **отклонён целиком** (`400`), а не «поле молча проигнорировано». Проверено вживую в процессе разработки:
  ```
  POST /auth/register { "nickname": "x", "password": "...", "isTelegramLinked": true }
  → 400 { "message": ["property isTelegramLinked should not exist"] }
  ```
- Единственное место в коде, где `User.telegramId`/`isTelegramLinked` вообще устанавливаются, — `UsersService.createFromTelegram` / `UsersService.linkTelegram`, а единственный вызывающий — `TelegramAuthService`, и только после того, как соответствующий Redis-код подтверждён обработкой `/start` от самого Telegram (см. раздел 4.2). Из HTTP-слоя эти поля недостижимы в принципе.

### 7.5. Хэширование паролей

**argon2id** (`argon2` пакет), параметры — рекомендованный OWASP минимум: `memoryCost = 19456` (19 MiB), `timeCost = 2`, `parallelism = 1`. Ни бренда plain SHA-256/MD5, ни bcrypt с заниженным cost — только argon2id с параметрами не ниже указанных. При необходимости поднять параметры под доступное железо — единственное место для правки: `ARGON2_OPTIONS` в `src/auth/auth.service.ts`.

### 7.6. Валидация входных данных

Все DTO — через `class-validator`/`class-transformer`. Никнейм — строгий regex-whitelist (`^[a-zA-Z0-9_]{3,32}$`), а не блэклист «запрещённых» символов. Числовые поля (`amount` в `TopUpDto`) — `@IsNumber` с ограничением знаков после запятой и верхней границей. UUID-параметры (`code`) — `@IsUUID('4')`, некорректный формат отклоняется до похода в Redis.

### 7.7. CORS / Helmet

- `app.enableCors({ origin: CORS_ORIGINS.split(','), credentials: true })` — явный whitelist из `.env`, никакого `origin: '*'` (со `credentials: true` это и не сработало бы — браузеры такое комбо запрещают, но важно не полагаться на это и держать whitelist явным).
- `helmet()` подключен глобально в `main.ts` — стандартный набор security-заголовков (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, CSP по умолчанию и т.д.). Для чистого JSON API (без отдачи HTML) дефолтные настройки Helmet ничего не ломают; если фронтенд когда-либо будет отдаваться этим же процессом — донастройте `contentSecurityPolicy` под конкретные источники скриптов/стилей.

### 7.8. Логирование подозрительной активности

В `AuditLog` (таблица в Postgres, `src/audit-log/`) пишутся: успешные/неуспешные регистрации и логины (в т.ч. отдельно — «неизвестный nickname» и «неверный пароль»), срабатывания rate-limit, попытки использовать протухший/использованный/чужой Telegram-код, конфликт привязки Telegram, отказ в пополнении баланса без привязанного Telegram, факт обнаружения повторного использования refresh-токена (recycling/угон сессии). **Пароли, значения JWT и содержимое Telegram auth-кодов никогда не пишутся** ни в `AuditLog`, ни в обычные логи приложения — только идентификаторы (`userId`, `nickname` при неудачном логине под несуществующим пользователем, `action`, `ip`, `userAgent`).

### 7.9. JWT и сессии

- Access-токен: 15–30 минут (по умолчанию 15м), передаётся в `httpOnly; SameSite=Strict` cookie (`Path=/`) либо `Authorization: Bearer` (для нестандартных клиентов).
- Refresh-токен: по умолчанию 7 дней, **только** в `httpOnly; SameSite=Strict` cookie с `Path=/auth` (не уходит ни в один другой эндпоинт, кроме `/auth/refresh` и `/auth/logout`).
- Refresh-токены хранятся в БД **в виде SHA-256 хэша** (`RefreshToken.tokenHash`), не в открытом виде — утечка базы не даёт готового к использованию токена.
- Ротация: каждый `POST /auth/refresh` немедленно помечает использованный refresh-токен `revoked = true` и выдаёт новую пару. Предъявление уже отозванного (провёрнутого) refresh-токена трактуется как вероятный угон сессии — **все** refresh-токены пользователя отзываются разом (`revokeAllForUser`), пользователю придётся залогиниться заново на всех устройствах. Проверено вживую: повторное предъявление старого токена после ротации → `401 REFRESH_TOKEN_REUSED`.
- `POST /auth/logout` отзывает refresh-токен, связанный с текущей сессией. Access-токены **не** отзываются индивидуально (это фундаментальное свойство stateless JWT) — поэтому их время жизни специально короткое (15–30 мин): после логаута соответствующая cookie физически удаляется браузером, а даже украденный до этого момента access-токен «сгорит» сам в течение максимум получаса.
- `JwtStrategy.validate()` при каждом запросе перечитывает пользователя из БД (не доверяет `isTelegramLinked`/`balance` в теле токена) — привязка Telegram отражается на всех уже открытых сессиях без необходимости перевыпускать токены.

### 7.10. Известные транзитивные уязвимости (npm audit)

`npm audit` на этом проекте показывает high-severity advisory в `deepmerge-ts` (< 8.0.0, stack exhaustion на рекурсивных объектах) — это транзитивная зависимость `@prisma/config`, которую тянет CLI-пакет `prisma` (используется только на этапе `prisma generate`/`migrate deploy`, то есть при сборке и старте контейнера, а не в коде, который обслуживает HTTP-запросы). На момент написания это последняя стабильная линия Prisma 6.x, и понижение версии, которое предлагает `npm audit fix --force`, откатывает Prisma назад — то есть является ухудшением, а не исправлением. Рекомендация: периодически перепроверять `npm audit` при обновлении зависимостей и подняться на следующую стабильную минорную/мажорную версию Prisma, когда она подтянет исправленный `deepmerge-ts`.

### 7.11. Чеклист перед продакшеном

- [ ] **HTTPS обязателен.** И Telegram Bot API (`setWebhook` принимает только `https://`-адреса), и `Secure`-cookie требуют валидный HTTPS-сертификат на публичном адресе. См. раздел 3.5 (`docker-compose.prod.yml` + nginx).
- [ ] `NODE_ENV=production` — включает `Secure` у cookie (в `docker-compose.prod.yml` уже прописано принудительно).
- [ ] Все секреты (`JWT_*_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, пароль Postgres) — сгенерированы заново для продакшена, не те же значения, что в dev/`*.example`.
- [ ] Раздельные `.env` для dev/staging/production, продакшен-файл не коммитится и не логируется целиком нигде (CI-переменные — через секрет-хранилище платформы, а не файл в репозитории).
- [ ] Регулярная ротация секретов (особенно `TELEGRAM_WEBHOOK_SECRET` и JWT-секретов) по внутреннему регламенту; при ротации JWT-секретов все текущие сессии инвалидируются одномоментно — планировать на окно с уведомлением пользователей.
- [ ] Бэкапы БД (Postgres) — регулярные, с проверкой восстановления, отдельно от бэкапов Redis (Redis тут — только эфемерные коды и rate-limit счётчики, его состояние не критично терять).
- [ ] Порты Postgres/Redis/приложения не должны быть доступны из интернета — при развёртывании через `docker-compose.prod.yml` (см. 3.5) они и так не публикуются наружу, единственная публичная точка входа — nginx на 80/443. Если разворачиваете иначе (свой reverse-proxy) — проследите за этим сами: либо убрать `ports:` у `postgres`/`redis`/`app`, либо забиндить на `127.0.0.1`.
- [ ] `CORS_ORIGINS` — точный список продакшен-доменов фронтенда, без `*`.
- [ ] `/docs` (Swagger) сейчас открыт всем без ограничений — сам по себе не раскрывает секретов (только структуру API, которая и так публична для фронтенда), но если хочется закрыть его от посторонних глаз в проде — самый простой способ: `location /docs { auth_basic ...; }` в `nginx/user_conf.d/vancodex.tech.conf`.
- [ ] Throttler переведён на Redis-backed storage при более чем одной реплике `app` (см. 7.2 и Roadmap).

---

## 8. Roadmap

- **2FA (TOTP)** для чисто nickname/password-аккаунтов, у которых нет привязанного Telegram (для тех, у кого Telegram привязан, разумная альтернатива — использовать сам Telegram как второй фактор через тот же deep-link механизм).
- **Восстановление пароля через привязанный Telegram** — бот присылает одноразовый код сброса тем же Redis-механизмом, что и вход (тот же `TelegramCodeService`, новый `mode: "password-reset"`). Дополнительно мотивирует привязывать Telegram даже тех, кому не нужен баланс.
- **Уведомления через бота о событиях аккаунта** — вход с нового устройства/IP, пополнение баланса, подозрительная активность (уже частично есть данные в `AuditLog`, не хватает только рассылки через `TelegramBotService.telegraf.telegram.sendMessage`).
- **RBAC**, если появится админ-панель — роль на `User` + guard по роли, по аналогии с `TelegramLinkedGuard`.
- **Отвязка/смена привязанного Telegram** с обязательным подтверждением через альтернативный способ входа (если есть пароль — подтвердить паролем; если Telegram — единственный способ входа, потребовать сначала задать пароль) — чтобы угнанная Telegram-сессия не могла тихо переехать на чужой Telegram-аккаунт.
- **Более подробный `AuditLog`** — уже реализован для auth/telegram/balance-действий; расширить на все будущие чувствительные действия по мере роста функциональности (единая точка расширения — `AuditLogService.log()`).
- **Отдельный Redis-namespace + мониторинг** для auth-кодов и rate-limit счётчиков (сейчас всё в одном Redis-инстансе с префиксами ключей `auth:tg:code:*` / `ratelimit:*`) — разнести физически при росте нагрузки, добавить метрики по objects/memory на namespace.
- **Полное удаление аккаунта** (GDPR-подобный флоу) — каскадное удаление уже настроено на уровне схемы (`RefreshToken.onDelete: Cascade`, `AuditLog.userId.onDelete: SetNull` — история действий обезличивается, а не исчезает бесследно), не хватает самого эндпоинта с подтверждением и, вероятно, периода отложенного удаления («передумал в течение N дней»).
- **Метрики и алерты** (Prometheus/Grafana) — экспортировать счётчики неудачных попыток входа, всплесков регистраций, срабатываний rate-limit и `TELEGRAM_ALREADY_LINKED`-конфликтов (все эти события уже проходят через `AuditLogService`/`RateLimitService` — остаётся добавить `prom-client` и снимать метрики с тех же точек).
- **Redis-backed storage для `@nestjs/throttler`** при масштabировании `app` на несколько реплик (см. 7.2/7.11) — сейчас IP-based лимиты in-memory и не разделяются между инстансами.
