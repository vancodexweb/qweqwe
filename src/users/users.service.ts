import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateFromTelegramInput {
  telegramId: bigint;
  telegramUsername: string | null;
}

export interface LinkTelegramInput {
  telegramId: bigint;
  telegramUsername: string | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByNickname(nickname: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { nickname } });
  }

  findByTelegramId(telegramId: bigint): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  createWithNickname(nickname: string, passwordHash: string): Promise<User> {
    return this.prisma.user.create({
      data: { nickname, passwordHash },
    });
  }

  /**
   * Автоматическая регистрация через Telegram: вызывается webhook-обработчиком
   * /start, когда пользователь с данным telegramId ещё не существует в базе.
   */
  createFromTelegram(input: CreateFromTelegramInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        telegramId: input.telegramId,
        telegramUsername: input.telegramUsername,
        isTelegramLinked: true,
      },
    });
  }

  /**
   * Привязка Telegram к уже существующему nickname/password-аккаунту.
   * Вызывается только из TelegramAuthService после подтверждения кода в Redis —
   * telegramId никогда не приходит сюда напрямую из тела HTTP-запроса.
   */
  linkTelegram(userId: string, input: LinkTelegramInput): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        telegramId: input.telegramId,
        telegramUsername: input.telegramUsername,
        isTelegramLinked: true,
      },
    });
  }
}
