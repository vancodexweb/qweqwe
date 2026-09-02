#!/bin/sh
set -e

echo "[entrypoint] Применение миграций Prisma (prisma migrate deploy)..."
npx prisma migrate deploy

echo "[entrypoint] Миграции применены. Запуск приложения..."
exec "$@"
