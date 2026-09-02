import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditAction } from './audit-log.constants';

export interface AuditLogEntry {
  action: AuditAction;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Дополнительный контекст. ВАЖНО: сюда никогда не передавать пароли, токены, JWT, коды подтверждения. */
  metadata?: Prisma.InputJsonValue;
}

/**
 * Журналирование действий пользователей и системы. Пишет в таблицу audit_logs.
 * Запись в аудит-лог никогда не должна ронять основной флоу запроса — при
 * ошибке записи просто логируем в stderr и продолжаем.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          userId: entry.userId ?? undefined,
          ip: entry.ip ?? undefined,
          userAgent: entry.userAgent ?? undefined,
          metadata: entry.metadata,
        },
      });
    } catch (error) {
      this.logger.error(`Не удалось записать audit log (action=${entry.action})`, error as Error);
    }
  }
}
