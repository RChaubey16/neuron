import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateEmailDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  to: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  body: string;
}
