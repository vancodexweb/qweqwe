import type { User } from '@prisma/client';

/**
 * Пользователь в виде, безопасном для отправки клиенту: без passwordHash,
 * а также с telegramId/balance, приведёнными к string.
 *
 * Зачем приведение типов: telegramId в Prisma — нативный bigint (т.к.
 * Telegram user id может превышать 2^31), а balance — Prisma.Decimal.
 * Стандартный JSON.stringify (его использует Express res.json) падает
 * с TypeError на bigint и теряет точность на Decimal, поэтому оба поля
 * явно приводятся к строке один раз здесь, а не полагаются на неявную
 * сериализацию где-то в контроллерах.
 */
export interface SafeUser extends Omit<User, 'passwordHash' | 'telegramId' | 'balance'> {
  telegramId: string | null;
  balance: string;
}

export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, telegramId, balance, ...rest } = user;

  return {
    ...rest,
    telegramId: telegramId !== null ? telegramId.toString() : null,
    balance: balance.toString(),
  };
}
