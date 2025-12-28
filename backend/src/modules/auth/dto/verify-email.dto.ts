import { IsString, IsNotEmpty, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Email verification token',
    example: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6',
    minLength: 64,
    maxLength: 64,
  })
  @IsString()
  @IsNotEmpty()
  @Length(64, 64, { message: 'Token must be exactly 64 characters long' })
  token: string;
}