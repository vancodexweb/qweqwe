import type { Request } from 'express';
import type { SafeUser } from '../../users/types/safe-user.type';

/** Request с уже подставленным JwtAuthGuard/JwtStrategy пользователем. */
export interface AuthenticatedRequest extends Request {
  user: SafeUser;
}

/** Request после JwtRefreshGuard: помимо payload несёт сырой refresh-токен из cookie. */
export interface RefreshRequest extends Request {
  user: {
    sub: string;
    jti: string;
    refreshToken: string;
  };
}
