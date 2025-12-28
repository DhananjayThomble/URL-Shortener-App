import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetPasswordDto {
  @ApiProperty({
    description: 'Password to protect the link',
    example: 'mySecretPassword',
    minLength: 4,
    maxLength: 128,
  })
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  password: string;

  @ApiProperty({
    description: 'Optional password hint for users',
    example: 'Your favorite color',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  hint?: string;
}

export class ValidatePasswordDto {
  @ApiProperty({
    description: 'Password to validate',
    example: 'mySecretPassword',
  })
  @IsString()
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Current password',
    example: 'oldPassword',
  })
  @IsString()
  currentPassword: string;

  @ApiProperty({
    description: 'New password',
    example: 'newSecretPassword',
    minLength: 4,
    maxLength: 128,
  })
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  newPassword: string;

  @ApiProperty({
    description: 'Optional new password hint',
    example: 'Your new favorite color',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  hint?: string;
}

export class UpdatePasswordHintDto {
  @ApiProperty({
    description: 'New password hint',
    example: 'Updated hint text',
  })
  @IsString()
  @MaxLength(255)
  hint: string;
}