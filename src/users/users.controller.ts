import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { SafeUser } from './types/safe-user.type';

@ApiTags('users')
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
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Текущий пользователь',
    description: 'Единственный способ для SPA восстановить сессию по httpOnly-cookie при загрузке страницы.',
  })
  @ApiResponse({
    status: 200,
    description: 'Данные текущего пользователя.',
    schema: {
      example: {
        id: 'd2ad549e-d0c8-4e36-a9ef-5898dd442ac8',
        nickname: 'ivan_2000',
        telegramId: null,
        telegramUsername: null,
        isTelegramLinked: false,
        balance: '0',
        createdAt: '2026-09-02T18:40:23.083Z',
        updatedAt: '2026-09-02T18:40:23.083Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Не авторизован.' })
  me(@CurrentUser() user: SafeUser): SafeUser {
    return user;
  }
}
