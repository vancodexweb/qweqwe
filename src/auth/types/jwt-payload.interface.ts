/** Payload access-токена. Намеренно минимальный: остальные данные пользователя
 * (isTelegramLinked, balance...) всегда читаются свежими из БД в JwtStrategy,
 * а не кэшируются в токене — иначе после привязки Telegram пришлось бы
 * принудительно перевыпускать все выданные access-токены. */
export interface AccessTokenPayload {
  sub: string;
}

/** Payload refresh-токена. jti — id строки в таблице refresh_tokens (не сам токен). */
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}
