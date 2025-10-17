import { SetMetadata } from '@nestjs/common';
import { AdminPermission } from '../../users/entities/admin-user.entity';

export const PERMISSION_KEY = 'permission';
export const RequirePermission = (permission: AdminPermission) => 
  SetMetadata(PERMISSION_KEY, permission);