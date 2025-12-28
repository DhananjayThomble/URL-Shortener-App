import { IsUrl, IsString, IsOptional, IsDateString, MaxLength, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class TagDto {
  @ApiProperty({
    description: 'Tag name',
    example: 'campaign',
  })
  @IsString()
  @MaxLength(50)
  name: string;

  @ApiProperty({
    description: 'Tag value',
    example: 'summer-2024',
  })
  @IsString()
  @MaxLength(100)
  value: string;
}

export class CreateUrlDto {
  @ApiProperty({
    description: 'Original URL to be shortened',
    example: 'https://www.example.com/very/long/url/path',
  })
  @IsUrl()
  originalUrl: string;

  @ApiProperty({
    description: 'Custom back-half for the short URL',
    example: 'my-custom-link',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  customBackHalf?: string;

  @ApiProperty({
    description: 'Category for organizing URLs',
    example: 'marketing',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiProperty({
    description: 'Expiration date for the URL',
    example: '2024-12-31T23:59:59.000Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: Date;

  @ApiProperty({
    description: 'Tags for the URL',
    type: [TagDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TagDto)
  tags?: TagDto[];

  @ApiProperty({
    description: 'Custom domain for the short URL',
    example: 'short.example.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  customDomain?: string;
}