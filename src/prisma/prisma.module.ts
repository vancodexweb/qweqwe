import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Глобальный модуль — PrismaService нужен практически в каждом модуле
 * приложения, регистрировать его локально в каждом импорте избыточно.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
