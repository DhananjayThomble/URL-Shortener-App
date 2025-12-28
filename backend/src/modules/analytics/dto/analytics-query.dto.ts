import { IsString, IsOptional, IsDateString, IsEnum, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AnalyticsPeriod {
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Link ID to filter analytics',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  linkId?: string;

  @ApiPropertyOptional({
    description: 'User ID to filter analytics',
    example: '123e4567-e89b-12d3-a456-426614174001'
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  userId?: string;

  @ApiProperty({
    description: 'Start date for analytics period',
    example: '2024-01-01T00:00:00Z'
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'End date for analytics period',
    example: '2024-01-31T23:59:59Z'
  })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({
    description: 'Aggregation period',
    enum: AnalyticsPeriod,
    example: AnalyticsPeriod.DAY,
    default: AnalyticsPeriod.DAY
  })
  @IsOptional()
  @IsEnum(AnalyticsPeriod)
  period?: AnalyticsPeriod = AnalyticsPeriod.DAY;

  @ApiPropertyOptional({
    description: 'Number of results to return',
    example: 100,
    minimum: 1,
    maximum: 1000,
    default: 100
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 100;

  @ApiPropertyOptional({
    description: 'Number of results to skip',
    example: 0,
    minimum: 0,
    default: 0
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class TopAnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Link ID to filter analytics',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  linkId?: string;

  @ApiPropertyOptional({
    description: 'User ID to filter analytics',
    example: '123e4567-e89b-12d3-a456-426614174001'
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  userId?: string;

  @ApiProperty({
    description: 'Start date for analytics period',
    example: '2024-01-01T00:00:00Z'
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'End date for analytics period',
    example: '2024-01-31T23:59:59Z'
  })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({
    description: 'Number of top results to return',
    example: 10,
    minimum: 1,
    maximum: 100,
    default: 10
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class RealTimeAnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Link ID to filter analytics',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  linkId?: string;

  @ApiPropertyOptional({
    description: 'User ID to filter analytics',
    example: '123e4567-e89b-12d3-a456-426614174001'
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Number of minutes to look back for real-time data',
    example: 60,
    minimum: 1,
    maximum: 1440,
    default: 60
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440) // Max 24 hours
  minutes?: number = 60;
}