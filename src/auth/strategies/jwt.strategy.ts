import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../../config/configuration';
import { toSafeUser, type SafeUser } from '../../users/types/safe-user.type';
import { UsersService } from '../../users/users.service';
import { ACCESS_TOKEN_COOKIE } from '../cookie.util';
import type { AccessTokenPayload } from '../types/jwt-payload.interface';

function cookieExtractor(req: Request): string | null {
  return (req?.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined) ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly usersService: UsersService,
  ) {
    super({
      // Сначала пробуем httpOnly-cookie (основной сценарий для браузера),
      // затем Authorization: Bearer — для нестандартных клиентов (мобильные приложения, Postman).
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  /**
   * Пользователь всегда перечитывается из БД, а не берётся из claims токена —
   * это гарантирует, что isTelegramLinked/balance в req.user всегда актуальны
   * (например, сразу после привязки Telegram без необходимости перевыпускать токен).
   */
  async validate(payload: AccessTokenPayload): Promise<SafeUser> {
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'Пользователь не найден.' });
    }

    return toSafeUser(user);
  }
}
