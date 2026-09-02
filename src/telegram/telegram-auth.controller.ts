import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

@Controller('auth/telegram')
export class TelegramAuthController {
  constructor(
    private readonly telegramAuthService: TelegramAuthService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /** Шаг 1-2 флоу логина: генерирует authCode и ссылки на бота. JWT не требуется. */
  @Post('login/start')
  @HttpCode(HttpStatus.OK)
  loginStart(): Promise<TelegramStartResponse> {
    return this.telegramAuthService.loginStart();
  }

  /** Старт привязки Telegram к уже залогиненному nickname/password-аккаунту. Требует JWT. */
  @Post('link/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  linkStart(@CurrentUser('id') userId: string, @Req() req: Request): Promise<TelegramStartResponse> {
    return this.telegramAuthService.linkStart(userId, extractRequestMeta(req));
  }

  /** Лёгкий поллинг статуса кода — без побочных эффектов, код не расходуется. */
  @Get('status')
  status(@Query() query: TelegramStatusQueryDto) {
    return this.telegramAuthService.status(query.code);
  }

  /** Финальное подтверждение: код обязан быть в статусе 'ready', расходуется один раз. */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
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
