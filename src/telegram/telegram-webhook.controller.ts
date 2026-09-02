import { Body, Controller, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TelegramWebhookSecretGuard } from './guards/telegram-webhook-secret.guard';
import { TelegramAuthService } from './telegram-auth.service';

/**
 * Вебхук Telegram. Публично объявлен под /telegram (не /auth/telegram), чтобы
 * пространство путей для людей (auth/telegram/*) и для Telegram-серверов
 * (telegram/webhook) не пересекалось. URL этого эндпоинта нигде в коде не
 * логируется (см. README, раздел "Безопасность").
 */
@ApiTags('telegram-webhook')
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
  @ApiOperation({
    summary: '(не вызывать вручную) Приём апдейтов от Telegram',
    description:
      'Вызывается только серверами Telegram после регистрации через setWebhook (см. README, раздел 3.2/3.5). ' +
      'Тело запроса — стандартный Telegram Update JSON, здесь не документируется отдельно.',
  })
  @ApiHeader({
    name: 'X-Telegram-Bot-Api-Secret-Token',
    description: 'Должен совпадать с TELEGRAM_WEBHOOK_SECRET из .env — задаётся Telegram-у при регистрации вебхука.',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Всегда 200 при верном secret token — даже если обработка апдейта внутри упала.', schema: { example: { ok: true } } })
  @ApiResponse({ status: 401, description: 'Неверный/отсутствующий X-Telegram-Bot-Api-Secret-Token.' })
  async handleWebhook(@Body() update: Record<string, unknown>): Promise<{ ok: true }> {
    try {
      await this.telegramAuthService.handleWebhookUpdate(update);
    } catch (error) {
      this.logger.error('Ошибка обработки Telegram-апдейта', error as Error);
    }

    return { ok: true };
  }
}
