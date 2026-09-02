import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { TelegramWebhookSecretGuard } from './guards/telegram-webhook-secret.guard';
import { TelegramAuthController } from './telegram-auth.controller';
import { TelegramAuthService } from './telegram-auth.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramCodeService } from './telegram-code.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [TelegramAuthController, TelegramWebhookController],
  providers: [TelegramAuthService, TelegramBotService, TelegramCodeService, TelegramWebhookSecretGuard],
})
export class TelegramAuthModule {}
