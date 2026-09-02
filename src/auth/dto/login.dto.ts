import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'Никнейм, указанный при регистрации.', example: 'ivan_2000' })
  @IsString()
  @MinLength(1, { message: 'Укажите никнейм.' })
  @MaxLength(32)
  nickname!: string;

  @ApiProperty({ description: 'Пароль.', example: 'correcthorsebatterystaple' })
  @IsString()
  @MinLength(1, { message: 'Укажите пароль.' })
  @MaxLength(128)
  password!: string;
}
