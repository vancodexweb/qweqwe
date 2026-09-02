import type { Request } from 'express';

export interface RequestMeta {
  ip: string;
  userAgent: string;
}

/**
 * Единообразное извлечение IP/User-Agent для аудит-лога и rate-limit.
 * req.ip корректен только при включённом `app.set('trust proxy', ...)`
 * (см. main.ts) — иначе за реверс-прокси все запросы будут выглядеть
 * пришедшими с одного IP.
 */
export function extractRequestMeta(req: Request): RequestMeta {
  return {
    ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    userAgent: req.headers['user-agent'] ?? 'unknown',
  };
}
