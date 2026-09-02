import { IsNumber, IsPositive, Max } from 'class-validator';

export class TopUpDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Сумма должна быть числом с не более чем 2 знаками после запятой.' })
  @IsPositive({ message: 'Сумма пополнения должна быть больше нуля.' })
  @Max(1_000_000, { message: 'Сумма пополнения слишком велика.' })
  amount!: number;
}
