import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../../config/configuration';
import { REFRESH_TOKEN_COOKIE } from '../cookie.util';
import type { RefreshTokenPayload } from '../types/jwt-payload.interface';

function cookieExtractor(req: Request): string | null {
  return (req?.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined) ?? null;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(configService: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.refreshSecret', { infer: true }),
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: RefreshTokenPayload): RefreshTokenPayload & { refreshToken: string } {
    // Токен уже прошёл проверку подписи/срока действия к этому моменту (passport-jwt).
    // Сырую строку возвращаем отдельно — TokenService сверяет её хэш с БД (defense-in-depth).
    const refreshToken = cookieExtractor(req) as string;
    return { ...payload, refreshToken };
  }
}
