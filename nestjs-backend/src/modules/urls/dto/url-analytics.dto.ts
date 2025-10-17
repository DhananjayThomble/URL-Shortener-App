import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetUrlAnalyticsDto {
  @ApiProperty({
    description: 'Time period for analytics',
    example: '7d',
    enum: ['24h', '7d', '30d', '90d'],
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsIn(['24h', '7d', '30d', '90d'], { message: 'Period must be one of: 24h, 7d, 30d, 90d' })
  period?: string = '7d';
}