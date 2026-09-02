import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import type { Update } from 'telegraf/types';
import type { AppConfig } from '../config/configuration';

/**
 * Тонкая обёртка над Telegraf. Намеренно не знает ничего про бизнес-логику
 * авторизации (TelegramAuthService) — иначе получился бы циклический импорт
 * (боту нужна auth-логика на /start, а auth-логике нужен бот, чтобы отвечать).
 * TelegramAuthService сам регистрирует обработчик /start поверх `telegraf`
 * в своём onModuleInit (см. telegram-auth.service.ts).
 *
 * Бот работает в режиме webhook (не polling): setWebhook выполняется вручную
 * через Telegram Bot API (см. README), поэтому здесь нет вызова bot.launch().
 */
@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);

  readonly telegraf: Telegraf;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.telegraf = new Telegraf(configService.get('telegram.botToken', { infer: true }));

    this.telegraf.catch((error) => {
      this.logger.error('Необработанная ошибка в обработчике Telegraf', error as Error);
    });
  }

  /**
   * Предзагружает getMe() и кэширует его в telegraf.botInfo. Без этого
   * Telegraf сам делает синхронный вызов getMe() внутри ПЕРВОГО handleUpdate
   * (см. исходники Telegraf: handleUpdate ждёt botInfo, если он ещё не
   * установлен) — а значит, первый реальный вебхук от Telegram упал бы
   * с 500, если бы этот единственный запрос getMe() не прошёл. Здесь же
   * ошибка не фатальна: остальной API не зависит от доступности Telegram,
   * а сам Telegraf повторит попытку при следующем вебхуке, если botInfo
   * так и не был установлен.
   */
  async onModuleInit(): Promise<void> {
    try {
      this.telegraf.botInfo = await this.telegraf.telegram.getMe();
      this.logger.log(`Telegram-бот инициализирован: @${this.telegraf.botInfo.username}`);
    } catch (error) {
      this.logger.warn(
        `Не удалось получить информацию о боте (getMe) при старте приложения: ${(error as Error).message}. ` +
          'Повторная попытка будет выполнена автоматически при обработке следующего вебхука.',
      );
    }
  }

  /** Передаёт "сырой" Update из тела вебхука в Telegraf. */
  async handleUpdate(update: Record<string, unknown>): Promise<void> {
    await this.telegraf.handleUpdate(update as unknown as Update);
  }
}
