import { Injectable } from '@nestjs/common';
import { AuditAction } from '../audit-log/audit-log.constants';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { RequestMeta } from '../common/utils/request-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { toSafeUser, type SafeUser } from '../users/types/safe-user.type';

@Injectable()
export class BalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async topUp(userId: string, amount: number, meta: RequestMeta): Promise<SafeUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { balance: { increment: amount } },
    });

    await this.auditLog.log({
      action: AuditAction.BALANCE_TOPUP,
      userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { amount },
    });

    return toSafeUser(user);
  }
}
