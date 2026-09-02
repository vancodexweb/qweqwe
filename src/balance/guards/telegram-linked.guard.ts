import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuditAction } from '../../audit-log/audit-log.constants';
import { AuditLogService } from '../../audit-log/audit-log.service';
import type { AuthenticatedRequest } from '../../common/interfaces/authenticated-request.interface';
import { extractRequestMeta } from '../../common/utils/request-meta.util';

/**
 * Требует, чтобы у пользователя был привязан Telegram (isTelegramLinked === true).
 * Применяется на финансовых эндпоинтах (пополнение баланса и т.п.) ПОСЛЕ
 * JwtAuthGuard: `@UseGuards(JwtAuthGuard, TelegramLinkedGuard)` — порядок
 * важен, т.к. этот guard полагается на req.user, заполненный JwtStrategy.
 */
@Injectable()
export class TelegramLinkedGuard implements CanActivate {
  constructor(private readonly auditLog: AuditLogService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user?.isTelegramLinked) {
      await this.auditLog.log({
        action: AuditAction.BALANCE_TOPUP_DENIED_TELEGRAM_REQUIRED,
        userId: request.user?.id,
        ...extractRequestMeta(request),
      });

      throw new ForbiddenException({
        code: 'TELEGRAM_LINK_REQUIRED',
        message: 'Для пополнения баланса необходимо привязать Telegram-аккаунт.',
      });
    }

    return true;
  }
}
