import type { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { parseDurationToMs } from '../common/utils/duration.util';
import type { AppConfig } from '../config/configuration';
import type { TokenPair } from './token.service';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Cookie-опции для JWT: httpOnly (недоступны из JS, защита от XSS-кражи токена),
 * Secure (только по HTTPS — включается автоматически в production, см. README
 * "Чеклист перед продакшеном"), SameSite=Strict (защита от CSRF).
 *
 * В dev-режиме Secure отключён намеренно, иначе браузер не примет cookie
 * при локальной разработке по обычному http://localhost.
 */
function baseCookieOptions(config: ConfigService<AppConfig, true>): CookieOptions {
  return {
    httpOnly: true,
    secure: config.get('isProduction', { infer: true }),
    sameSite: 'strict',
    domain: config.get('cookieDomain', { infer: true }),
  };
}

export function setAuthCookies(
  res: Response,
  config: ConfigService<AppConfig, true>,
  tokens: TokenPair,
): void {
  const base = baseCookieOptions(config);

  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...base,
    path: '/',
    maxAge: parseDurationToMs(config.get('jwt.accessExpiresIn', { infer: true })),
  });

  // Refresh-cookie ограничена path=/auth: она не должна утекать в запросы
  // к остальным эндпоинтам (нужна только /auth/refresh и /auth/logout).
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...base,
    path: '/auth',
    maxAge: parseDurationToMs(config.get('jwt.refreshExpiresIn', { infer: true })),
  });
}

export function clearAuthCookies(res: Response, config: ConfigService<AppConfig, true>): void {
  const base = baseCookieOptions(config);
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, path: '/auth' });
}
