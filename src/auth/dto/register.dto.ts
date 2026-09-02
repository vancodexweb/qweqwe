import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** 3-32 символа: латинские буквы, цифры, подчёркивание. Regex whitelist — никаких других символов. */
const NICKNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;

export class RegisterDto {
  @IsString()
  @Matches(NICKNAME_REGEX, {
    message: 'Никнейм должен содержать от 3 до 32 символов: латинские буквы, цифры и подчёркивание.',
  })
  nickname!: string;

  @IsString()
  @MinLength(8, { message: 'Пароль должен быть не короче 8 символов.' })
  @MaxLength(128, { message: 'Пароль не должен превышать 128 символов.' })
  password!: string;
}
