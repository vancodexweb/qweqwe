# syntax=docker/dockerfile:1

# ===================== Стадия 1: builder =====================
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# python3/make/g++ — на случай, если для платформы сборки нет готового
# prebuild-бинаря нативного аддона argon2 и его придётся собирать из исходников.
# openssl нужен Prisma CLI, чтобы на этапе generate корректно определить
# движок под используемый на этом образе OpenSSL (debian-openssl-3.0.x).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

# prisma (CLI) намеренно объявлен в package.json как обычная dependency
# (не devDependency) — entrypoint.sh выполняет `npx prisma migrate deploy`
# уже в production-образе, где нет доступа к сети для догрузки CLI.
RUN npm prune --omit=dev

# ===================== Стадия 2: production =====================
FROM node:22-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system nodeapp \
    && useradd --system --gid nodeapp --home-dir /app --shell /usr/sbin/nologin nodeapp

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY docker/entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh && chown -R nodeapp:nodeapp /app

USER nodeapp
EXPOSE 3000

# Перед стартом приложения entrypoint.sh накатывает миграции (prisma migrate deploy).
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/main.js"]
