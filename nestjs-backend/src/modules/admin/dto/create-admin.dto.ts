import { IsEmail, IsString, IsArray, IsEnum, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AdminPermission } from '../../users/entities/admin-user.entity';

export class CreateAdminDto {
  @ApiProperty({ example: 'admin@example.com', description: 'Admin email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePassword123!', description: 'Admin password (min 8 characters)' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'John Doe', description: 'Admin full name' })
  @IsString()
  name: string;

  @ApiProperty({
    example: [AdminPermission.USER_MANAGEMENT, AdminPermission.ANALYTICS_VIEW],
    description: 'Array of admin permissions',
    enum: AdminPermission,
    isArray: true,
  })
  @IsArray()
  @IsEnum(AdminPermission, { each: true })
  permissions: AdminPermission[];
}