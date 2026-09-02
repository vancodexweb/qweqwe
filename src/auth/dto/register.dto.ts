import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** 3-32 символа: латинские буквы, цифры, подчёркивание. Regex whitelist — никаких других символов. */
const NICKNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;

export class RegisterDto {
  @ApiProperty({
    description: 'Никнейм: 3-32 символа, латинские буквы/цифры/подчёркивание.',
    example: 'ivan_2000',
    minLength: 3,
    maxLength: 32,
  })
  @IsString()
  @Matches(NICKNAME_REGEX, {
    message: 'Никнейм должен содержать от 3 до 32 символов: латинские буквы, цифры и подчёркивание.',
  })
  nickname!: string;

  @ApiProperty({
    description: 'Пароль: 8-128 символов. Хэшируется через argon2id, в открытом виде нигде не сохраняется.',
    example: 'correcthorsebatterystaple',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8, { message: 'Пароль должен быть не короче 8 символов.' })
  @MaxLength(128, { message: 'Пароль не должен превышать 128 символов.' })
  password!: string;
}
