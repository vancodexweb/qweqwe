import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuditAction } from '../../audit-log/audit-log.constants';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { extractRequestMeta } from '../../common/utils/request-meta.util';
import type { AppConfig } from '../../config/configuration';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Единственная защита вебхука: без корректного X-Telegram-Bot-Api-Secret-Token
 * запрос отклоняется с 401 ДО того, как тело будет передано в Telegraf.
 * Секрет задаётся при регистрации вебхука через setWebhook (см. README) и
 * никогда не совпадает с TELEGRAM_BOT_TOKEN.
 */
@Injectable()
export class TelegramWebhookSecretGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly auditLog: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const headerValue = request.headers[SECRET_HEADER];
    const providedSecret = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const expectedSecret = this.configService.get('telegram.webhookSecret', { infer: true });

    if (!providedSecret || providedSecret !== expectedSecret) {
      await this.auditLog.log({
        action: AuditAction.TELEGRAM_WEBHOOK_UNAUTHORIZED,
        ...extractRequestMeta(request),
      });

      throw new UnauthorizedException({
        code: 'WEBHOOK_UNAUTHORIZED',
        message: 'Неверный или отсутствующий secret token вебхука.',
      });
    }

    return true;
  }
}
