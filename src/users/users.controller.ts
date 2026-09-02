import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { SafeUser } from './types/safe-user.type';

@Controller('users')
export class UsersController {
  /**
   * Профиль текущего пользователя. Т.к. JWT лежит в httpOnly-cookie и
   * недоступен фронтенду напрямую, это единственный способ для SPA понять
   * при загрузке страницы, залогинен ли пользователь, и получить его данные
   * (включая isTelegramLinked — от него зависит, показывать ли баннер
   * "привяжите Telegram, чтобы пополнять баланс").
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: SafeUser): SafeUser {
    return user;
  }
}
