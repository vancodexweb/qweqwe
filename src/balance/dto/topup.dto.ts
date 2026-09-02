import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, Max } from 'class-validator';

export class TopUpDto {
  @ApiProperty({
    description: 'Сумма пополнения. Положительное число, не более 2 знаков после запятой.',
    example: 500,
    minimum: 0.01,
    maximum: 1_000_000,
  })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Сумма должна быть числом с не более чем 2 знаками после запятой.' })
  @IsPositive({ message: 'Сумма пополнения должна быть больше нуля.' })
  @Max(1_000_000, { message: 'Сумма пополнения слишком велика.' })
  amount!: number;
}
