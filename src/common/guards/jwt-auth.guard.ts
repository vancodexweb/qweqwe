import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { SafeUser } from '../../users/types/safe-user.type';

/**
 * Проверяет access-токен (стратегия 'jwt', см. AuthModule -> JwtStrategy).
 * Живёт вне AuthModule намеренно: guard не имеет собственных зависимостей
 * (стратегия регистрируется в глобальном passport-инстансе при старте
 * приложения), поэтому его можно использовать в UsersModule/BalanceModule/
 * TelegramAuthModule напрямую через @UseGuards, не создавая циклический
 * импорт этих модулей с AuthModule.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = SafeUser>(
    err: unknown,
    user: TUser | false,
    _info: unknown,
    _context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Требуется авторизация. Войдите заново.',
      });
    }
    return user;
  }
}
