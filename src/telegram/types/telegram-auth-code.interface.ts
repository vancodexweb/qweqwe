export type TelegramAuthCodeStatus = 'pending' | 'ready' | 'used' | 'error';
export type TelegramAuthCodeMode = 'login' | 'link';

/**
 * Структура, которая хранится в Redis по ключу auth:tg:code:{code}.
 * Статусы и их смысл подробно описаны в README, раздел "Флоу авторизации".
 */
export interface TelegramAuthCodePayload {
  status: TelegramAuthCodeStatus;
  mode: TelegramAuthCodeMode;
  createdAt: number;

  /** Только для mode='link': id уже залогиненного пользователя, инициировавшего привязку. */
  requestUserId?: string;

  /** Проставляется в момент обработки /start в боте, когда пользователь определён. */
  userId?: string;
  telegramId?: string;
  telegramUsername?: string | null;

  /** Только для status='error' — код ошибки для конкретики ответа клиенту. */
  errorCode?: string;
}

export interface TelegramStartResponse {
  authCode: string;
  /** Deep-link для десктопа/веба. */
  telegramDeepLink: string;
  /** Deep-link с tg:// схемой — открывает нативное приложение Telegram на мобильных. */
  telegramDeepLinkApp: string;
  expiresInSeconds: number;
}
