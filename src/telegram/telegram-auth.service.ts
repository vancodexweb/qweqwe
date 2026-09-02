import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenService, type TokenPair } from '../auth/token.service';
import { AuditAction } from '../audit-log/audit-log.constants';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { RequestMeta } from '../common/utils/request-meta.util';
import type { AppConfig } from '../config/configuration';
import { RateLimitService } from '../redis/rate-limit.service';
import { toSafeUser, type SafeUser } from '../users/types/safe-user.type';
import { UsersService } from '../users/users.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramCodeService } from './telegram-code.service';
import type {
  TelegramAuthCodeMode,
  TelegramAuthCodeStatus,
  TelegramStartResponse,
} from './types/telegram-auth-code.interface';

const LINK_START_LIMIT = 5;
const LINK_START_WINDOW_SECONDS = 60;

export interface TelegramConfirmResult {
  mode: TelegramAuthCodeMode;
  user: SafeUser;
  tokens: TokenPair;
}

/** Данные, извлечённые из Telegraf-контекста в момент /start — без привязки к типам Telegraf. */
interface StartInput {
  code: string | undefined;
  telegramId: number | undefined;
  telegramUsername: string | null;
  reply: (text: string, confirmButtonUrl?: string) => Promise<unknown>;
}

@Injectable()
export class TelegramAuthService implements OnModuleInit {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly codeService: TelegramCodeService,
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly auditLog: AuditLogService,
    private readonly rateLimit: RateLimitService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  onModuleInit(): void {
    this.bot.telegraf.start(async (ctx) => {
      await this.handleStart({
        code: ctx.startPayload,
        telegramId: ctx.from?.id,
        telegramUsername: ctx.from?.username ?? null,
        reply: (text, confirmButtonUrl) => {
          if (!confirmButtonUrl) {
            return ctx.reply(text);
          }

          return ctx.reply(text, {
            reply_markup: {
              inline_keyboard: [[{ text: 'Подтвердить вход', url: confirmButtonUrl }]],
            },
          });
        },
      });
    });
  }

  /** Передаёт "сырой" Update из webhook-контроллера в Telegraf (см. TelegramWebhookController). */
  async handleWebhookUpdate(update: Record<string, unknown>): Promise<void> {
    await this.bot.handleUpdate(update);
  }

  async loginStart(): Promise<TelegramStartResponse> {
    const { code, expiresInSeconds } = await this.codeService.createLoginCode();
    return this.buildStartResponse(code, expiresInSeconds);
  }

  async linkStart(userId: string, meta: RequestMeta): Promise<TelegramStartResponse> {
    const rateLimitResult = await this.rateLimit.hit(`tglink:user:${userId}`, LINK_START_LIMIT, LINK_START_WINDOW_SECONDS);

    if (!rateLimitResult.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Слишком много запросов на привязку Telegram. Попробуйте позже.',
          retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { code, expiresInSeconds } = await this.codeService.createLinkCode(userId);

    await this.auditLog.log({
      action: AuditAction.TELEGRAM_LINK_START,
      userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.buildStartResponse(code, expiresInSeconds);
  }

  async status(code: string): Promise<{ status: TelegramAuthCodeStatus | 'expired'; errorCode?: string }> {
    const payload = await this.codeService.getCode(code);

    if (!payload) {
      return { status: 'expired' };
    }

    return { status: payload.status, errorCode: payload.errorCode };
  }

  async confirm(code: string, meta: RequestMeta): Promise<TelegramConfirmResult> {
    const payload = await this.codeService.getCode(code);

    if (!payload) {
      throw new NotFoundException({
        code: 'AUTH_CODE_INVALID',
        message: 'Код недействителен, истёк или уже был использован.',
      });
    }

    if (payload.status === 'pending') {
      throw new ConflictException({
        code: 'AUTH_CODE_PENDING',
        message: 'Вы ещё не подтвердили вход в Telegram. Нажмите Start в боте.',
      });
    }

    if (payload.status === 'used') {
      await this.auditLog.log({
        action: AuditAction.TELEGRAM_AUTH_CODE_REUSE_ATTEMPT,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      throw new ConflictException({
        code: 'AUTH_CODE_ALREADY_USED',
        message: 'Этот код уже был использован.',
      });
    }

    if (payload.status === 'error') {
      throw new ConflictException({
        code: payload.errorCode ?? 'AUTH_CODE_ERROR',
        message: 'Не удалось подтвердить вход через Telegram.',
      });
    }

    const consumed = await this.codeService.markUsed(code);

    if (!consumed?.userId) {
      throw new NotFoundException({
        code: 'AUTH_CODE_INVALID',
        message: 'Код недействителен, истёк или уже был использован.',
      });
    }

    const user = await this.usersService.findById(consumed.userId);

    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Пользователь не найден.' });
    }

    const tokens = await this.tokenService.issueTokenPair(user.id, meta);

    if (consumed.mode === 'login') {
      await this.auditLog.log({
        action: AuditAction.TELEGRAM_LOGIN_SUCCESS,
        userId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    return { mode: consumed.mode, user: toSafeUser(user), tokens };
  }

  private async handleStart(input: StartInput): Promise<void> {
    const { code, telegramId, telegramUsername, reply } = input;

    if (!code) {
      await reply(
        'Привет! Этот бот используется для входа на сайт. Откройте страницу входа и нажмите «Войти через Telegram».',
      );
      return;
    }

    if (telegramId === undefined) {
      return;
    }

    const existingCode = await this.codeService.getCode(code);

    if (!existingCode) {
      await reply('Ссылка для входа устарела или уже была использована. Вернитесь на сайт и запросите новую.');
      return;
    }

    if (existingCode.status === 'ready') {
      // Повторное нажатие Start по той же ссылке — идемпотентно показываем кнопку ещё раз.
      await this.sendConfirmPrompt(reply, code);
      return;
    }

    if (existingCode.status !== 'pending') {
      await reply('Эта ссылка для входа больше не действительна. Вернитесь на сайт и запросите новую.');
      return;
    }

    const telegramIdBig = BigInt(telegramId);

    if (existingCode.mode === 'login') {
      await this.handleLoginStart(code, telegramIdBig, telegramUsername);
    } else {
      const handled = await this.handleLinkStart(code, existingCode.requestUserId, telegramIdBig, telegramUsername, reply);
      if (!handled) {
        return;
      }
    }

    await this.sendConfirmPrompt(reply, code);
  }

  private async handleLoginStart(code: string, telegramIdBig: bigint, telegramUsername: string | null): Promise<void> {
    let user = await this.usersService.findByTelegramId(telegramIdBig);

    if (!user) {
      try {
        user = await this.usersService.createFromTelegram({ telegramId: telegramIdBig, telegramUsername });
        await this.auditLog.log({
          action: AuditAction.TELEGRAM_AUTO_REGISTER,
          userId: user.id,
          metadata: { telegramId: telegramIdBig.toString() },
        });
      } catch (error) {
        // Гонка: пользователь мог быть создан параллельным /start между findByTelegramId и create
        // (telegramId уникален на уровне БД). Пробуем перечитать перед тем, как считать это ошибкой.
        user = await this.usersService.findByTelegramId(telegramIdBig);
        if (!user) {
          throw error;
        }
      }
    }

    await this.codeService.markReady(code, {
      userId: user.id,
      telegramId: telegramIdBig.toString(),
      telegramUsername,
    });
  }

  /** Возвращает false, если пользователю уже отправлен финальный ответ и общий "готово" из handleStart слать не нужно. */
  private async handleLinkStart(
    code: string,
    requestUserId: string | undefined,
    telegramIdBig: bigint,
    telegramUsername: string | null,
    reply: StartInput['reply'],
  ): Promise<boolean> {
    if (!requestUserId) {
      await this.codeService.markError(code, 'INVALID_LINK_CODE');
      await reply('Не удалось привязать Telegram: код повреждён. Попробуйте снова из личного кабинета.');
      return false;
    }

    const conflictingUser = await this.usersService.findByTelegramId(telegramIdBig);

    if (conflictingUser && conflictingUser.id !== requestUserId) {
      await this.codeService.markError(code, 'TELEGRAM_ALREADY_LINKED');
      await this.auditLog.log({
        action: AuditAction.TELEGRAM_LINK_CONFLICT,
        userId: requestUserId,
        metadata: { telegramId: telegramIdBig.toString() },
      });
      await reply(
        'Этот Telegram-аккаунт уже привязан к другому пользователю на сайте. Отвяжите его или используйте другой аккаунт Telegram.',
      );
      return false;
    }

    await this.usersService.linkTelegram(requestUserId, { telegramId: telegramIdBig, telegramUsername });

    await this.codeService.markReady(code, {
      userId: requestUserId,
      telegramId: telegramIdBig.toString(),
      telegramUsername,
    });

    await this.auditLog.log({
      action: AuditAction.TELEGRAM_LINK_SUCCESS,
      userId: requestUserId,
      metadata: { telegramId: telegramIdBig.toString() },
    });

    return true;
  }

  private async sendConfirmPrompt(reply: StartInput['reply'], code: string): Promise<void> {
    const frontendUrl = this.configService.get('frontendUrl', { infer: true }).replace(/\/$/, '');
    const confirmUrl = `${frontendUrl}/auth/telegram/confirm?code=${code}`;
    await reply('Готово! Чтобы завершить вход, нажмите на кнопку ниже.', confirmUrl);
  }

  private buildStartResponse(code: string, expiresInSeconds: number): TelegramStartResponse {
    const botUsername = this.configService.get('telegram.botUsername', { infer: true });

    return {
      authCode: code,
      telegramDeepLink: `https://t.me/${botUsername}?start=${code}`,
      telegramDeepLinkApp: `tg://resolve?domain=${botUsername}&start=${code}`,
      expiresInSeconds,
    };
  }
}
