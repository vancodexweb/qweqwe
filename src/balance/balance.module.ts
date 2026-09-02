import { Module } from '@nestjs/common';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';
import { TelegramLinkedGuard } from './guards/telegram-linked.guard';

@Module({
  controllers: [BalanceController],
  providers: [BalanceService, TelegramLinkedGuard],
})
export class BalanceModule {}
