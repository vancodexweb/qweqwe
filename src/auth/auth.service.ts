import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuditAction } from '../audit-log/audit-log.constants';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { RequestMeta } from '../common/utils/request-meta.util';
import { RateLimitService } from '../redis/rate-limit.service';
import { toSafeUser, type SafeUser } from '../users/types/safe-user.type';
import { UsersService } from '../users/users.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { TokenService, type TokenPair } from './token.service';
import type { RefreshTokenPayload } from './types/jwt-payload.interface';

/** Рекомендованные OWASP параметры для argon2id (минимум): m=19MiB, t=2, p=1. */
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const LOGIN_ATTEMPTS_PER_NICKNAME = 10;
const LOGIN_ATTEMPTS_WINDOW_SECONDS = 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly auditLog: AuditLogService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta): Promise<SafeUser> {
    const existing = await this.usersService.findByNickname(dto.nickname);

    if (existing) {
      throw new ConflictException({
        code: 'NICKNAME_TAKEN',
        message: 'Этот никнейм уже занят.',
      });
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    const user = await this.usersService.createWithNickname(dto.nickname, passwordHash);

    await this.auditLog.log({
      action: AuditAction.REGISTER,
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return toSafeUser(user);
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<{ user: SafeUser; tokens: TokenPair }> {
    // Лимит попыток по nickname (в дополнение к IP-throttling на уровне контроллера) —
    // защищает конкретный аккаунт от распределённого брутфорса с разных IP.
    const nicknameKey = dto.nickname.toLowerCase();
    const rateLimitResult = await this.rateLimit.hit(
      `login:nickname:${nicknameKey}`,
      LOGIN_ATTEMPTS_PER_NICKNAME,
      LOGIN_ATTEMPTS_WINDOW_SECONDS,
    );

    if (!rateLimitResult.allowed) {
      await this.auditLog.log({
        action: AuditAction.LOGIN_RATE_LIMITED,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { nickname: dto.nickname },
      });

      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Слишком много попыток входа для этого никнейма. Попробуйте позже.',
          retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.usersService.findByNickname(dto.nickname);

    if (!user || !user.passwordHash) {
      await this.auditLog.log({
        action: AuditAction.LOGIN_FAILED_UNKNOWN_NICKNAME,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { nickname: dto.nickname },
      });

      throw new NotFoundException({
        code: 'NICKNAME_NOT_REGISTERED',
        message: 'Пользователь с таким никнеймом не найден. Сначала зарегистрируйтесь.',
      });
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);

    if (!passwordValid) {
      await this.auditLog.log({
        action: AuditAction.LOGIN_FAILED_WRONG_PASSWORD,
        userId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Неверный никнейм или пароль.',
      });
    }

    const tokens = await this.tokenService.issueTokenPair(user.id, meta);

    await this.auditLog.log({
      action: AuditAction.LOGIN_SUCCESS,
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { user: toSafeUser(user), tokens };
  }

  async refresh(payload: RefreshTokenPayload, rawToken: string, meta: RequestMeta): Promise<TokenPair> {
    const tokens = await this.tokenService.rotateRefreshToken(payload, rawToken, meta);

    await this.auditLog.log({
      action: AuditAction.TOKEN_REFRESH,
      userId: payload.sub,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return tokens;
  }

  async logout(userId: string, refreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (refreshToken) {
      await this.tokenService.revokeByRawToken(refreshToken);
    }

    await this.auditLog.log({
      action: AuditAction.LOGOUT,
      userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }
}
