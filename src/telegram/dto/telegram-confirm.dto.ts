import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class TelegramConfirmDto {
  @ApiProperty({
    description: 'Одноразовый код, полученный из /auth/telegram/login/start или /auth/telegram/link/start.',
    example: '6f2fb95d-5b88-4336-b4fd-1511dd855aa0',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'Некорректный формат кода.' })
  code!: string;
}
