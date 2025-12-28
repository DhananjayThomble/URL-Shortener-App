import { ApiProperty } from '@nestjs/swagger';

export class TagResponseDto {
  @ApiProperty({
    description: 'Tag ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Tag name',
    example: 'Marketing',
  })
  name: string;

  @ApiProperty({
    description: 'Tag color in hex format',
    example: '#6366f1',
  })
  color: string;

  @ApiProperty({
    description: 'Tag creation date',
    example: '2023-12-01T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Number of links associated with this tag',
    example: 5,
  })
  linkCount?: number;
}