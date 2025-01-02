import { IsUrl, Length } from 'class-validator';

export class ValidateUrlDto {
  @IsUrl({}, { message: 'Invalid URL' })
  url: string;
}

export class ValidateShortIdDto {
  @Length(10, 10, { message: 'Invalid URL' })
  short: string;
}
