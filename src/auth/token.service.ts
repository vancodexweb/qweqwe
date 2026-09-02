import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/configuration';
import type { RequestMeta } from '../common/utils/request-meta.util';
import { parseDurationToMs } from '../common/utils/duration.util';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, RefreshTokenPayload } from './types/jwt-payload.interface';

/**
 * jsonwebtoken типизирует expiresIn как branded string-литерал (например "15m"),
 * а не произвольный string — но наше значение приходит из .env (валидируется
 * в env.validation.ts как обычная строка). Кастуем один раз в общем хелпере,
 * а не в каждом месте вызова sign().
 */
function toJwtExpiresIn(value: string): JwtSignOptions['expiresIn'] {
  return value as JwtSignOptions['expiresIn'];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Выпуск, ротация и отзыв JWT-пары.
 *
 * Refresh-токены хранятся в БД только в виде SHA-256 хэша (RefreshToken.tokenHash) —
 * утечка базы не даёт возможности восстановить рабочий токен. Идентификатор
 * строки (jti) зашивается в сам JWT, чтобы отзыв/ротация выполнялись по
 * первичному ключу, а не полным сканированием таблицы по хэшу.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {}

  async issueTokenPair(userId: string, meta: RequestMeta): Promise<TokenPair> {
    const accessToken = this.signAccessToken(userId);
    const refreshToken = await this.issueRefreshToken(userId, meta);
    return { accessToken, refreshToken };
  }

  signAccessToken(userId: string): string {
    const payload: AccessTokenPayload = { sub: userId };
    return this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.accessSecret', { infer: true }),
      expiresIn: toJwtExpiresIn(this.configService.get('jwt.accessExpiresIn', { infer: true })),
    });
  }

  /**
   * Ротация refresh-токена по правилу "один раз использовал — токен сгорел".
   * Если предъявлен токен, уже помеченный revoked (то есть кто-то использует
   * повторно уже провёрнутый refresh-токен — явный признак кражи), в целях
   * безопасности отзываются ВСЕ refresh-токены пользователя.
   */
  async rotateRefreshToken(
    payload: RefreshTokenPayload,
    rawToken: string,
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const existing = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });

    if (!existing || existing.userId !== payload.sub || existing.tokenHash !== this.hashToken(rawToken)) {
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_INVALID',
        message: 'Недействительный refresh-токен. Войдите заново.',
      });
    }

    if (existing.revoked) {
      await this.revokeAllForUser(payload.sub);
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Обнаружено повторное использование refresh-токена. Все сессии отозваны, войдите заново.',
      });
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_EXPIRED',
        message: 'Срок действия сессии истёк. Войдите заново.',
      });
    }

    await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revoked: true } });

    return this.issueTokenPair(payload.sub, meta);
  }

  /** Отзыв конкретного refresh-токена (logout). Тихо игнорирует отсутствующий/чужой токен. */
  async revokeByRawToken(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(rawToken) },
      data: { revoked: true },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  private async issueRefreshToken(userId: string, meta: RequestMeta): Promise<string> {
    const jti = randomUUID();
    const expiresIn = this.configService.get('jwt.refreshExpiresIn', { infer: true });
    const expiresAt = new Date(Date.now() + parseDurationToMs(expiresIn));

    const payload: RefreshTokenPayload = { sub: userId, jti };
    const token = this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.refreshSecret', { infer: true }),
      expiresIn: toJwtExpiresIn(expiresIn),
    });

    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        userId,
        tokenHash: this.hashToken(token),
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    return token;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
