import { IsString, IsOptional, IsUrl, IsBoolean, Length } from 'class-validator';

export class CreateBioLinkDto {
  @IsString()
  @Length(1, 100)
  title: string;

  @IsUrl({}, { message: 'URL must be a valid URL' })
  url: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  icon?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}