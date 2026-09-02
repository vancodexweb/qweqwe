import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import type { SafeUser } from '../../users/types/safe-user.type';

/**
 * Достаёт текущего пользователя из req.user (заполняется JwtStrategy).
 * Использование: `@CurrentUser() user: SafeUser` или `@CurrentUser('id') userId: string`.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof SafeUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return field ? request.user?.[field] : request.user;
  },
);
