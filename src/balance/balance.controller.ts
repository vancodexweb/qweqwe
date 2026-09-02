import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { extractRequestMeta } from '../common/utils/request-meta.util';
import type { SafeUser } from '../users/types/safe-user.type';
import { BalanceService } from './balance.service';
import { TopUpDto } from './dto/topup.dto';
import { TelegramLinkedGuard } from './guards/telegram-linked.guard';

@Controller('balance')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  /**
   * Пополнение баланса. TelegramLinkedGuard подключён ПОСЛЕ JwtAuthGuard —
   * порядок в @UseGuards важен (guards выполняются слева направо, а этот
   * guard читает req.user, который заполняет JwtAuthGuard). Пользователь без
   * привязанного Telegram получит 403 { code: 'TELEGRAM_LINK_REQUIRED' }.
   * Этот же guard следует навешивать на любые другие финансовые эндпоинты.
   */
  @Post('topup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, TelegramLinkedGuard)
  async topUp(
    @CurrentUser('id') userId: string,
    @Body() dto: TopUpDto,
    @Req() req: Request,
  ): Promise<{ user: SafeUser }> {
    const user = await this.balanceService.topUp(userId, dto.amount, extractRequestMeta(req));
    return { user };
  }
}
