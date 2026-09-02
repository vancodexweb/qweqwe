import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/**
 * Глобальный модуль: аудит-логирование нужно из auth, telegram и balance —
 * проще подключить один раз, чем импортировать в каждом фиче-модуле.
 */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
