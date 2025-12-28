import { IsString, IsDate, IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClickEventDto {
  @ApiProperty({
    description: 'ID of the clicked link',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsString()
  @IsUUID()
  linkId: string;

  @ApiProperty({
    description: 'ID of the user who owns the link',
    example: '123e4567-e89b-12d3-a456-426614174001'
  })
  @IsString()
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'Timestamp when the link was clicked',
    example: '2024-01-15T10:30:00Z'
  })
  @IsDate()
  @Type(() => Date)
  clickedAt: Date;

  @ApiProperty({
    description: 'Hashed IP address of the visitor',
    example: 'a1b2c3d4e5f6...'
  })
  @IsString()
  ipHash: string;

  @ApiPropertyOptional({
    description: 'User agent string from the browser',
    example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  })
  @IsOptional()
  @IsString()
  userAgent?: string;

  @ApiPropertyOptional({
    description: 'Detected browser name',
    example: 'Chrome'
  })
  @IsOptional()
  @IsString()
  browser?: string;

  @ApiPropertyOptional({
    description: 'Detected device type',
    example: 'desktop'
  })
  @IsOptional()
  @IsString()
  device?: string;

  @ApiPropertyOptional({
    description: 'Detected operating system',
    example: 'Windows'
  })
  @IsOptional()
  @IsString()
  os?: string;

  @ApiPropertyOptional({
    description: 'Detected country from IP geolocation',
    example: 'United States'
  })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    description: 'Detected city from IP geolocation',
    example: 'New York'
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    description: 'HTTP referrer header',
    example: 'https://google.com'
  })
  @IsOptional()
  @IsString()
  referrer?: string;

  @ApiPropertyOptional({
    description: 'UTM source parameter',
    example: 'google'
  })
  @IsOptional()
  @IsString()
  utmSource?: string;

  @ApiPropertyOptional({
    description: 'UTM medium parameter',
    example: 'cpc'
  })
  @IsOptional()
  @IsString()
  utmMedium?: string;

  @ApiPropertyOptional({
    description: 'UTM campaign parameter',
    example: 'summer_sale'
  })
  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @ApiPropertyOptional({
    description: 'UTM term parameter',
    example: 'url shortener'
  })
  @IsOptional()
  @IsString()
  utmTerm?: string;

  @ApiPropertyOptional({
    description: 'UTM content parameter',
    example: 'banner_ad'
  })
  @IsOptional()
  @IsString()
  utmContent?: string;

  @ApiPropertyOptional({
    description: 'Whether the visitor is detected as a bot',
    example: false,
    default: false
  })
  @IsOptional()
  @IsBoolean()
  isBot?: boolean;

  @ApiPropertyOptional({
    description: 'Session ID for tracking unique visitors',
    example: 'sess_123456789'
  })
  @IsOptional()
  @IsString()
  sessionId?: string;
}