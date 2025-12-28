import { IsString, IsArray, IsEnum, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AdminPermission } from '../../users/entities/admin-user.entity';

export class UpdateAdminDto {
  @ApiProperty({ example: 'John Doe', description: 'Admin full name', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    example: [AdminPermission.USER_MANAGEMENT, AdminPermission.ANALYTICS_VIEW],
    description: 'Array of admin permissions',
    enum: AdminPermission,
    isArray: true,
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(AdminPermission, { each: true })
  permissions?: AdminPermission[];

  @ApiProperty({ example: true, description: 'Whether the admin account is active', required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}