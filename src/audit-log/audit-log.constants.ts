/** Действия, которые пишутся в AuditLog. Строковые значения — это то, что реально хранится в БД. */
export enum AuditAction {
  REGISTER = 'register',
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILED_UNKNOWN_NICKNAME = 'login_failed_unknown_nickname',
  LOGIN_FAILED_WRONG_PASSWORD = 'login_failed_wrong_password',
  LOGIN_RATE_LIMITED = 'login_rate_limited',
  LOGOUT = 'logout',
  TOKEN_REFRESH = 'token_refresh',
  TOKEN_REFRESH_REUSE_DETECTED = 'token_refresh_reuse_detected',

  TELEGRAM_AUTO_REGISTER = 'telegram_auto_register',
  TELEGRAM_LOGIN_SUCCESS = 'telegram_login_success',
  TELEGRAM_LINK_START = 'telegram_link_start',
  TELEGRAM_LINK_SUCCESS = 'telegram_link_success',
  TELEGRAM_LINK_CONFLICT = 'telegram_link_conflict',
  TELEGRAM_AUTH_CODE_INVALID_ATTEMPT = 'telegram_auth_code_invalid_attempt',
  TELEGRAM_AUTH_CODE_REUSE_ATTEMPT = 'telegram_auth_code_reuse_attempt',
  TELEGRAM_WEBHOOK_UNAUTHORIZED = 'telegram_webhook_unauthorized',

  BALANCE_TOPUP = 'balance_topup',
  BALANCE_TOPUP_DENIED_TELEGRAM_REQUIRED = 'balance_topup_denied_telegram_required',
}
