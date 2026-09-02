import { Body, Controller, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { TelegramWebhookSecretGuard } from './guards/telegram-webhook-secret.guard';
import { TelegramAuthService } from './telegram-auth.service';

/**
 * Вебхук Telegram. Публично объявлен под /telegram (не /auth/telegram), чтобы
 * пространство путей для людей (auth/telegram/*) и для Telegram-серверов
 * (telegram/webhook) не пересекалось. URL этого эндпоинта нигде в коде не
 * логируется (см. README, раздел "Безопасность").
 */
@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(private readonly telegramAuthService: TelegramAuthService) {}

  /**
   * Всегда отвечает 200, даже если обработка внутри упала. Так рекомендует
   * сам Telegram: не-2xx ответ трактуется как "доставка не удалась" и апдейт
   * будет повторно отправлен позже — а наш /start-флоу для части ошибок
   * (например, сеть до Telegram моргнула на середине ответа пользователю)
   * не обязан быть переигран, чтобы не плодить дублирующиеся побочные эффекты.
   * Ошибка в любом случае не теряется — она попадает в логи приложения.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TelegramWebhookSecretGuard)
  async handleWebhook(@Body() update: Record<string, unknown>): Promise<{ ok: true }> {
    try {
      await this.telegramAuthService.handleWebhookUpdate(update);
    } catch (error) {
      this.logger.error('Ошибка обработки Telegram-апдейта', error as Error);
    }

    return { ok: true };
  }
}
