import { IsOptional, IsBoolean, IsEnum, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DuplicateHandlingStrategy {
  SKIP = 'skip',
  UPDATE = 'update',
  ERROR = 'error',
}

export class BulkImportOptionsDto {
  @ApiPropertyOptional({
    description: 'Strategy for handling duplicate short codes',
    enum: DuplicateHandlingStrategy,
    default: DuplicateHandlingStrategy.SKIP,
  })
  @IsOptional()
  @IsEnum(DuplicateHandlingStrategy)
  duplicateHandling?: DuplicateHandlingStrategy = DuplicateHandlingStrategy.SKIP;

  @ApiPropertyOptional({
    description: 'Whether to validate URLs before importing',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  validateUrls?: boolean = true;

  @ApiPropertyOptional({
    description: 'Whether to generate short codes for missing ones',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  generateMissingShortCodes?: boolean = true;

  @ApiPropertyOptional({
    description: 'Whether to create missing tags',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createMissingTags?: boolean = true;

  @ApiPropertyOptional({
    description: 'Batch size for processing records',
    default: 100,
  })
  @IsOptional()
  batchSize?: number = 100;
}

export class BulkImportResponseDto {
  @ApiProperty({ description: 'Unique job ID for tracking progress' })
  jobId: string;

  @ApiProperty({ description: 'Operation ID for status tracking' })
  operationId: string;

  @ApiProperty({ description: 'Initial status of the import operation' })
  status: string;

  @ApiProperty({ description: 'Estimated processing time in seconds' })
  estimatedTime?: number;
}

export interface CsvLinkRecord {
  originalUrl: string;
  shortCode?: string;
  customAlias?: string;
  title?: string;
  isActive?: boolean;
  expiresAt?: string;
  password?: string;
  passwordHint?: string;
  iosUrl?: string;
  androidUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  metaPixelId?: string;
  googleAnalyticsId?: string;
  tiktokPixelId?: string;
  tags?: string; // Comma-separated tag names
  geoRules?: string; // JSON string of geo rules
}