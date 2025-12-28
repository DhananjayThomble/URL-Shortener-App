import { IsArray, IsUUID, ArrayNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignTagsToLinkDto {
  @ApiProperty({
    description: 'Array of tag IDs to assign to the link',
    example: ['123e4567-e89b-12d3-a456-426614174000', '987fcdeb-51a2-43d1-b789-123456789abc'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  tagIds: string[];
}

export class RemoveTagsFromLinkDto {
  @ApiProperty({
    description: 'Array of tag IDs to remove from the link',
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  tagIds: string[];
}

export class UpdateLinkTagsDto {
  @ApiProperty({
    description: 'Array of tag IDs to set for the link (replaces all existing tags)',
    example: ['123e4567-e89b-12d3-a456-426614174000', '987fcdeb-51a2-43d1-b789-123456789abc'],
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds: string[];
}

export class FilterLinksByTagsDto {
  @ApiPropertyOptional({
    description: 'Array of tag IDs to filter by (OR operation)',
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds?: string[];

  @ApiPropertyOptional({
    description: 'Array of tag names to filter by (OR operation)',
    example: ['Marketing', 'Social Media'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  tagNames?: string[];
}