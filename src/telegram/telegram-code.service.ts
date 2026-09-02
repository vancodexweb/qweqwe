import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service';
import {
  TELEGRAM_AUTH_CODE_TTL_SECONDS,
  TELEGRAM_AUTH_CODE_USED_TTL_SECONDS,
  telegramAuthCodeKey,
} from './telegram-code.constants';
import type { TelegramAuthCodePayload } from './types/telegram-auth-code.interface';

/**
 * Управление одноразовыми Telegram auth-кодами в Redis. Это единственное
 * место в приложении, которое читает/пишет ключи auth:tg:code:*.
 */
@Injectable()
export class TelegramCodeService {
  constructor(private readonly redis: RedisService) {}

  async createLoginCode(): Promise<{ code: string; expiresInSeconds: number }> {
    const code = randomUUID();
    const payload: TelegramAuthCodePayload = {
      status: 'pending',
      mode: 'login',
      createdAt: Date.now(),
    };

    await this.redis.setJson(telegramAuthCodeKey(code), payload, TELEGRAM_AUTH_CODE_TTL_SECONDS);
    return { code, expiresInSeconds: TELEGRAM_AUTH_CODE_TTL_SECONDS };
  }

  async createLinkCode(requestUserId: string): Promise<{ code: string; expiresInSeconds: number }> {
    const code = randomUUID();
    const payload: TelegramAuthCodePayload = {
      status: 'pending',
      mode: 'link',
      createdAt: Date.now(),
      requestUserId,
    };

    await this.redis.setJson(telegramAuthCodeKey(code), payload, TELEGRAM_AUTH_CODE_TTL_SECONDS);
    return { code, expiresInSeconds: TELEGRAM_AUTH_CODE_TTL_SECONDS };
  }

  getCode(code: string): Promise<TelegramAuthCodePayload | null> {
    return this.redis.getJson<TelegramAuthCodePayload>(telegramAuthCodeKey(code));
  }

  /** Переводит код в 'ready'. TTL не продлевается — сохраняется остаток исходных 5 минут. */
  async markReady(
    code: string,
    fields: Pick<TelegramAuthCodePayload, 'userId' | 'telegramId' | 'telegramUsername'>,
  ): Promise<void> {
    const existing = await this.getCode(code);
    if (!existing) {
      return;
    }

    const updated: TelegramAuthCodePayload = { ...existing, ...fields, status: 'ready' };
    await this.redis.setJsonPreservingTtl(telegramAuthCodeKey(code), updated, TELEGRAM_AUTH_CODE_TTL_SECONDS);
  }

  async markError(code: string, errorCode: string): Promise<void> {
    const existing = await this.getCode(code);
    if (!existing) {
      return;
    }

    const updated: TelegramAuthCodePayload = { ...existing, status: 'error', errorCode };
    await this.redis.setJsonPreservingTtl(telegramAuthCodeKey(code), updated, TELEGRAM_AUTH_CODE_TTL_SECONDS);
  }

  /**
   * Помечает код использованным (короткоживущий tombstone) и возвращает
   * его данные ДО пометки — вызывающий код должен успеть забрать userId/mode
   * из возвращённого значения, т.к. это единственный момент, когда они доступны.
   */
  async markUsed(code: string): Promise<TelegramAuthCodePayload | null> {
    const existing = await this.getCode(code);
    if (!existing) {
      return null;
    }

    const updated: TelegramAuthCodePayload = { ...existing, status: 'used' };
    await this.redis.setJson(telegramAuthCodeKey(code), updated, TELEGRAM_AUTH_CODE_USED_TTL_SECONDS);
    return existing;
  }
}
