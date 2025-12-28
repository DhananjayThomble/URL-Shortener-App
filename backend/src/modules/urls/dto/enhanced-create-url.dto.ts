import {
  IsUrl,
  IsString,
  IsOptional,
  IsDateString,
  MaxLength,
  IsArray,
  ValidateNested,
  Matches,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UTMParametersDto {
  @ApiProperty({
    description: 'UTM source parameter',
    example: 'google',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  utm_source?: string;

  @ApiProperty({
    description: 'UTM medium parameter',
    example: 'cpc',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  utm_medium?: string;

  @ApiProperty({
    description: 'UTM campaign parameter',
    example: 'summer_sale',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  utm_campaign?: string;

  @ApiProperty({
    description: 'UTM term parameter',
    example: 'running_shoes',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  utm_term?: string;

  @ApiProperty({
    description: 'UTM content parameter',
    example: 'banner_ad',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  utm_content?: string;
}

export class TrackingPixelsDto {
  @ApiProperty({
    description: 'Meta (Facebook) Pixel ID',
    example: '1234567890123456',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'Meta Pixel ID must be numeric' })
  metaPixelId?: string;

  @ApiProperty({
    description: 'Google Analytics tracking ID',
    example: 'G-XXXXXXXXXX',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^(UA-\d+-\d+|G-[A-Z0-9]+)$/, {
    message: 'Google Analytics ID must be in format UA-XXXXXXX-X or G-XXXXXXXXXX',
  })
  googleAnalyticsId?: string;

  @ApiProperty({
    description: 'TikTok Pixel ID',
    example: 'ABCD1234EFGH5678',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]+$/, { message: 'TikTok Pixel ID must be alphanumeric' })
  tiktokPixelId?: string;
}

export class GeoTargetingRuleDto {
  @ApiProperty({
    description: 'ISO 3166-1 alpha-2 country code',
    example: 'US',
  })
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'Country code must be a valid 2-letter ISO code' })
  countryCode: string;

  @ApiProperty({
    description: 'Redirect URL for this country',
    example: 'https://example.com/us',
  })
  @IsUrl()
  redirectUrl: string;
}

export class EnhancedCreateUrlDto {
  @ApiProperty({
    description: 'Original URL to be shortened',
    example: 'https://www.example.com/very/long/url/path',
  })
  @IsUrl()
  originalUrl: string;

  @ApiProperty({
    description: 'Custom alias for the short URL',
    example: 'my-custom-link',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Custom alias can only contain letters, numbers, hyphens, and underscores',
  })
  customAlias?: string;

  @ApiProperty({
    description: 'Title for the link',
    example: 'My Awesome Link',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({
    description: 'Expiration date for the URL',
    example: '2024-12-31T23:59:59.000Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: Date;

  @ApiProperty({
    description: 'Password for protecting the link',
    example: 'mySecretPassword',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  password?: string;

  @ApiProperty({
    description: 'Password hint for users',
    example: 'Your favorite color',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  passwordHint?: string;

  @ApiProperty({
    description: 'iOS-specific URL for mobile routing',
    example: 'https://apps.apple.com/app/myapp',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  iosUrl?: string;

  @ApiProperty({
    description: 'Android-specific URL for mobile routing',
    example: 'https://play.google.com/store/apps/details?id=com.myapp',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  androidUrl?: string;

  @ApiProperty({
    description: 'UTM parameters for campaign tracking',
    type: UTMParametersDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UTMParametersDto)
  utmParameters?: UTMParametersDto;

  @ApiProperty({
    description: 'Tracking pixel configuration',
    type: TrackingPixelsDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrackingPixelsDto)
  trackingPixels?: TrackingPixelsDto;

  @ApiProperty({
    description: 'Geo-targeting rules for country-specific redirects',
    type: [GeoTargetingRuleDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GeoTargetingRuleDto)
  geoTargetingRules?: GeoTargetingRuleDto[];
}