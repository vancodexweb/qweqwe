import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1, { message: 'Укажите никнейм.' })
  @MaxLength(32)
  nickname!: string;

  @IsString()
  @MinLength(1, { message: 'Укажите пароль.' })
  @MaxLength(128)
  password!: string;
}
