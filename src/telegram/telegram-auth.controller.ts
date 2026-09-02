import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { setAuthCookies } from '../auth/cookie.util';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { extractRequestMeta } from '../common/utils/request-meta.util';
import type { AppConfig } from '../config/configuration';
import type { SafeUser } from '../users/types/safe-user.type';
import { TelegramConfirmDto } from './dto/telegram-confirm.dto';
import { TelegramStatusQueryDto } from './dto/telegram-status.dto';
import { TelegramAuthService } from './telegram-auth.service';
import type { TelegramAuthCodeMode, TelegramStartResponse } from './types/telegram-auth-code.interface';

const START_RESPONSE_EXAMPLE = {
  authCode: '6f2fb95d-5b88-4336-b4fd-1511dd855aa0',
  telegramDeepLink: 'https://t.me/my_auth_bot?start=6f2fb95d-5b88-4336-b4fd-1511dd855aa0',
  telegramDeepLinkApp: 'tg://resolve?domain=my_auth_bot&start=6f2fb95d-5b88-4336-b4fd-1511dd855aa0',
  expiresInSeconds: 300,
};

@ApiTags('telegram-auth')
@Controller('auth/telegram')
export class TelegramAuthController {
  constructor(
    private readonly telegramAuthService: TelegramAuthService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /** Шаг 1-2 флоу логина: генерирует authCode и ссылки на бота. JWT не требуется. */
  @Post('login/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Начать вход через Telegram',
    description: 'Генерирует одноразовый authCode (TTL 5 минут) и ссылки на бота. JWT не требуется.',
  })
  @ApiResponse({ status: 200, description: 'Код и ссылки на бота созданы.', schema: { example: START_RESPONSE_EXAMPLE } })
  loginStart(): Promise<TelegramStartResponse> {
    return this.telegramAuthService.loginStart();
  }

  /** Старт привязки Telegram к уже залогиненному nickname/password-аккаунту. Требует JWT. */
  @Post('link/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Начать привязку Telegram к текущему аккаунту',
    description: 'Требует JWT. Тот же механизм, что и login/start, но код несёт userId залогиненного пользователя.',
  })
  @ApiResponse({ status: 200, description: 'Код и ссылки на бота созданы.', schema: { example: START_RESPONSE_EXAMPLE } })
  @ApiResponse({ status: 401, description: 'Не авторизован.' })
  @ApiResponse({ status: 429, description: 'Превышен лимит запросов (5/мин по IP и по userId).' })
  linkStart(@CurrentUser('id') userId: string, @Req() req: Request): Promise<TelegramStartResponse> {
    return this.telegramAuthService.linkStart(userId, extractRequestMeta(req));
  }

  /** Лёгкий поллинг статуса кода — без побочных эффектов, код не расходуется. */
  @Get('status')
  @ApiOperation({
    summary: 'Статус одноразового кода',
    description: 'Без побочных эффектов — можно поллить сколько угодно, код не расходуется.',
  })
  @ApiResponse({
    status: 200,
    description: 'Текущий статус кода.',
    schema: { example: { status: 'ready' }, properties: { status: { enum: ['pending', 'ready', 'used', 'error', 'expired'] }, errorCode: { type: 'string', nullable: true } } },
  })
  @ApiResponse({ status: 400, description: 'code не в формате UUID.' })
  status(@Query() query: TelegramStatusQueryDto) {
    return this.telegramAuthService.status(query.code);
  }

  /** Финальное подтверждение: код обязан быть в статусе 'ready', расходуется один раз. */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Подтвердить вход/привязку по коду',
    description: 'Код должен быть в статусе ready. При успехе выставляет httpOnly-cookie с JWT и немедленно расходует код (повторно использовать нельзя).',
  })
  @ApiResponse({
    status: 200,
    description: 'Вход подтверждён.',
    schema: {
      example: {
        mode: 'login',
        user: {
          id: 'd2ad549e-d0c8-4e36-a9ef-5898dd442ac8',
          nickname: null,
          telegramId: '987654321',
          telegramUsername: 'ivan',
          isTelegramLinked: true,
          balance: '0',
          createdAt: '2026-09-02T18:40:23.083Z',
          updatedAt: '2026-09-02T18:40:23.083Z',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Код не найден (протух или никогда не существовал).', schema: { example: { statusCode: 404, code: 'AUTH_CODE_INVALID', message: 'Код недействителен, истёк или уже был использован.' } } })
  @ApiResponse({ status: 409, description: 'Код ещё не подтверждён в боте, уже использован, либо конфликт привязки (telegramId уже занят другим аккаунтом).' })
  async confirm(
    @Body() dto: TelegramConfirmDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ mode: TelegramAuthCodeMode; user: SafeUser }> {
    const result = await this.telegramAuthService.confirm(dto.code, extractRequestMeta(req));
    setAuthCookies(res, this.configService, result.tokens);
    return { mode: result.mode, user: result.user };
  }
}
