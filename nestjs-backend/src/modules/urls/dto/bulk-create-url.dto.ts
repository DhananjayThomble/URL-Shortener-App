import { IsArray, ValidateNested, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CreateUrlDto } from './create-url.dto';

export class BulkCreateUrlDto {
  @ApiProperty({
    description: 'Array of URLs to create',
    type: [CreateUrlDto],
    maxItems: 100,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateUrlDto)
  @ArrayMaxSize(100, { message: 'Maximum 100 URLs can be created at once' })
  urls: CreateUrlDto[];
}