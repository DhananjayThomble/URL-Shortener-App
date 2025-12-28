import { IsString, IsOptional, IsBoolean, IsUrl, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateBioPageDto {
  @IsString()
  @Length(3, 50)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Username can only contain letters, numbers, underscores, and hyphens',
  })
  @Transform(({ value }) => value?.toLowerCase())
  username: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  bio?: string;

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  theme?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'Background color must be a valid hex color',
  })
  backgroundColor?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'Text color must be a valid hex color',
  })
  textColor?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  buttonStyle?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}