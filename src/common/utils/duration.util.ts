const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Парсит длительности вида "15m", "7d", "30s", "900" (голое число — секунды)
 * в миллисекунды. Используется для maxAge cookie, который должен совпадать
 * со сроком жизни соответствующего JWT (JWT_ACCESS_EXPIRES_IN / JWT_REFRESH_EXPIRES_IN).
 */
export function parseDurationToMs(value: string): number {
  const trimmed = value.trim();
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(trimmed);

  if (!match) {
    throw new Error(
      `Не удалось распарсить длительность "${value}". Ожидается формат вида "15m", "7d", "900s" или "900".`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 's';

  return amount * UNIT_TO_MS[unit];
}
