import { IsOptional, IsBoolean, IsDateString, IsArray, IsString } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class BulkExportOptionsDto {
  @ApiPropertyOptional({
    description: 'Include analytics data in export',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeAnalytics?: boolean = true;

  @ApiPropertyOptional({
    description: 'Include tag information',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeTags?: boolean = true;

  @ApiPropertyOptional({
    description: 'Include geo-targeting rules',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeGeoRules?: boolean = true;

  @ApiPropertyOptional({
    description: 'Include password-protected links',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includePasswordProtected?: boolean = false;

  @ApiPropertyOptional({
    description: 'Export only active links',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean = false;

  @ApiPropertyOptional({
    description: 'Start date for filtering links (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'End date for filtering links (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by specific tags',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => Array.isArray(value) ? value : value.split(','))
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Maximum number of records to export',
    default: 10000,
  })
  @IsOptional()
  limit?: number = 10000;
}

export class BulkExportResponseDto {
  @ApiProperty({ description: 'Unique job ID for tracking progress' })
  jobId: string;

  @ApiProperty({ description: 'Operation ID for status tracking' })
  operationId: string;

  @ApiProperty({ description: 'Initial status of the export operation' })
  status: string;

  @ApiProperty({ description: 'Estimated processing time in seconds' })
  estimatedTime?: number;
}