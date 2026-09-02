import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { extractRequestMeta } from '../common/utils/request-meta.util';
import type { SafeUser } from '../users/types/safe-user.type';
import { BalanceService } from './balance.service';
import { TopUpDto } from './dto/topup.dto';
import { TelegramLinkedGuard } from './guards/telegram-linked.guard';

@ApiTags('balance')
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
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Пополнение баланса',
    description: 'Требует привязанный Telegram-аккаунт (isTelegramLinked = true) — иначе 403 TELEGRAM_LINK_REQUIRED.',
  })
  @ApiResponse({
    status: 200,
    description: 'Баланс пополнен.',
    schema: {
      example: {
        user: {
          id: 'd2ad549e-d0c8-4e36-a9ef-5898dd442ac8',
          nickname: 'ivan_2000',
          telegramId: '987654321',
          telegramUsername: 'ivan',
          isTelegramLinked: true,
          balance: '500',
          createdAt: '2026-09-02T18:40:23.083Z',
          updatedAt: '2026-09-02T18:40:23.083Z',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Не авторизован.' })
  @ApiResponse({ status: 403, description: 'Telegram не привязан.', schema: { example: { statusCode: 403, code: 'TELEGRAM_LINK_REQUIRED', message: 'Для пополнения баланса необходимо привязать Telegram-аккаунт.' } } })
  @ApiResponse({ status: 400, description: 'Некорректная сумма.' })
  async topUp(
    @CurrentUser('id') userId: string,
    @Body() dto: TopUpDto,
    @Req() req: Request,
  ): Promise<{ user: SafeUser }> {
    const user = await this.balanceService.topUp(userId, dto.amount, extractRequestMeta(req));
    return { user };
  }
}
