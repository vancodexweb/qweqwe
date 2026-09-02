import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  async register(@Body() dto: RegisterDto, @Req() req: Request): Promise<{ user: SafeUser }> {
    const user = await this.authService.register(dto, extractRequestMeta(req));
    return { user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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
