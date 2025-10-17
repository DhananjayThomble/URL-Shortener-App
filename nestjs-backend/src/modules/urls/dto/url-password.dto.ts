import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetUrlPasswordDto {
  @ApiProperty({
    description: 'Password to protect the URL',
    example: 'mySecurePassword123',
    minLength: 6,
    maxLength: 100,
  })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  @MaxLength(100, { message: 'Password must not exceed 100 characters' })
  password: string;
}

export class ValidateUrlPasswordDto {
  @ApiProperty({
    description: 'Password to access the protected URL',
    example: 'mySecurePassword123',
  })
  @IsString()
  password: string;
}