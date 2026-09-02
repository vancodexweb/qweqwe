import { IsUUID } from 'class-validator';

export class TelegramConfirmDto {
  @IsUUID('4', { message: 'Некорректный формат кода.' })
  code!: string;
}
