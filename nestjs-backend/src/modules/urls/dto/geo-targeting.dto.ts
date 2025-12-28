import { IsString, IsUrl, IsArray, ValidateNested, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateGeoRuleDto {
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

export class UpdateGeoRulesDto {
  @ApiProperty({
    description: 'Array of geo-targeting rules',
    type: [CreateGeoRuleDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGeoRuleDto)
  rules: CreateGeoRuleDto[];
}

export class GeoTargetingStatsDto {
  @ApiProperty({
    description: 'Time period for statistics',
    example: '7d',
    enum: ['24h', '7d', '30d', '90d'],
  })
  @IsString()
  @Matches(/^(24h|7d|30d|90d)$/, { message: 'Period must be one of: 24h, 7d, 30d, 90d' })
  period: string;
}