import { IsUUID } from 'class-validator';

export class TelegramStatusQueryDto {
  @IsUUID('4', { message: 'Некорректный формат кода.' })
  code!: string;
}
