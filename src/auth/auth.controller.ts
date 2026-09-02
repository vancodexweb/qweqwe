import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { JwtRefreshGuard } from '../common/guards/jwt-refresh.guard';
import { extractRequestMeta } from '../common/utils/request-meta.util';
import type { AppConfig } from '../config/configuration';
import type { SafeUser } from '../users/types/safe-user.type';
import { AuthService } from './auth.service';
import { REFRESH_TOKEN_COOKIE, clearAuthCookies, setAuthCookies } from './cookie.util';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { RefreshTokenPayload } from './types/jwt-payload.interface';

const SAFE_USER_EXAMPLE = {
  id: 'd2ad549e-d0c8-4e36-a9ef-5898dd442ac8',
  nickname: 'ivan_2000',
  telegramId: null,
  telegramUsername: null,
  isTelegramLinked: false,
  balance: '0',
  createdAt: '2026-09-02T18:40:23.083Z',
  updatedAt: '2026-09-02T18:40:23.083Z',
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Регистрация nickname/password-аккаунта. Токены не выдаются —
   * это отдельный, явный шаг (POST /auth/login), см. README раздел 4.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Регистрация по никнейму и паролю',
    description: 'Создаёт nickname/password-аккаунт. JWT не выдаёт — после регистрации нужен отдельный POST /auth/login.',
  })
  @ApiResponse({ status: 201, description: 'Аккаунт создан.', schema: { example: { user: SAFE_USER_EXAMPLE } } })
  @ApiResponse({ status: 400, description: 'Никнейм/пароль не проходят валидацию.' })
  @ApiResponse({ status: 409, description: 'Никнейм уже занят.', schema: { example: { statusCode: 409, code: 'NICKNAME_TAKEN', message: 'Этот никнейм уже занят.' } } })
  @ApiResponse({ status: 429, description: 'Превышен лимит запросов (5/мин по IP).' })
  async register(@Body() dto: RegisterDto, @Req() req: Request): Promise<{ user: SafeUser }> {
    const user = await this.authService.register(dto, extractRequestMeta(req));
    return { user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Вход по никнейму и паролю',
    description: 'При успехе выставляет httpOnly-cookie access_token и refresh_token.',
  })
  @ApiResponse({ status: 200, description: 'Успешный вход.', schema: { example: { user: SAFE_USER_EXAMPLE } } })
  @ApiResponse({ status: 404, description: 'Никнейм не зарегистрирован.', schema: { example: { statusCode: 404, code: 'NICKNAME_NOT_REGISTERED', message: 'Пользователь с таким никнеймом не найден. Сначала зарегистрируйтесь.' } } })
  @ApiResponse({ status: 401, description: 'Неверный пароль.', schema: { example: { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Неверный никнейм или пароль.' } } })
  @ApiResponse({ status: 429, description: 'Превышен лимит попыток (10/мин по IP и по никнейму).' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: SafeUser }> {
    const { user, tokens } = await this.authService.login(dto, extractRequestMeta(req));
    setAuthCookies(res, this.configService, tokens);
    return { user };
  }

  /** Ротация пары токенов по refresh-cookie. Старый refresh-токен сгорает немедленно. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtRefreshGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Обновление пары токенов',
    description: 'Требует валидный refresh_token в cookie (Path=/auth). Ротирует токен — старый немедленно становится недействителен.',
  })
  @ApiResponse({ status: 200, description: 'Токены обновлены (новые придут в Set-Cookie).', schema: { example: { status: 'ok' } } })
  @ApiResponse({ status: 401, description: 'Refresh-токен недействителен/истёк/уже отозван, либо обнаружено повторное использование (все сессии отозваны).' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ status: 'ok' }> {
    const user = req.user as RefreshTokenPayload & { refreshToken: string };

    const tokens = await this.authService.refresh(
      { sub: user.sub, jti: user.jti },
      user.refreshToken,
      extractRequestMeta(req),
    );

    setAuthCookies(res, this.configService, tokens);
    return { status: 'ok' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Выход', description: 'Отзывает refresh-токен текущей сессии и очищает cookie.' })
  @ApiResponse({ status: 200, description: 'Выход выполнен.', schema: { example: { status: 'ok' } } })
  @ApiResponse({ status: 401, description: 'Не авторизован.' })
  async logout(
    @CurrentUser('id') userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'ok' }> {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    await this.authService.logout(userId, refreshToken, extractRequestMeta(req));
    clearAuthCookies(res, this.configService);
    return { status: 'ok' };
  }
}
