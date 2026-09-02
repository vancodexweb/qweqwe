/** TTL одноразового кода авторизации — 5 минут, как задано в ТЗ. */
export const TELEGRAM_AUTH_CODE_TTL_SECONDS = 5 * 60;

/**
 * Сколько ещё "живёт" код после успешного использования — в виде записи
 * со статусом 'used'. Нужно, чтобы повторный/дублирующийся confirm-запрос
 * (двойной клик, retry на фронте) получал понятный ответ "уже использован",
 * а не неотличимое от протухшего "код не найден". Сам факт входа код
 * повторно уже выдать не может — это лишь короткоживущий tombstone.
 */
export const TELEGRAM_AUTH_CODE_USED_TTL_SECONDS = 30;

const TELEGRAM_AUTH_CODE_PREFIX = 'auth:tg:code:';

export function telegramAuthCodeKey(code: string): string {
  return `${TELEGRAM_AUTH_CODE_PREFIX}${code}`;
}
