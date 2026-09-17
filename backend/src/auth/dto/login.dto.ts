import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email!: string;

  // Length is validated at registration. Here it is only bounded to stop a
  // megabyte of input reaching the hashing function.
  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  @MaxLength(512)
  password!: string;
}
