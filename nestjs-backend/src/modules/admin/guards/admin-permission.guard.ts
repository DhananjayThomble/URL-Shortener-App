import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AdminPermission } from '../../users/entities/admin-user.entity';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<AdminPermission>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission) {
      return true; // No specific permission required
    }

    const request = context.switchToHttp().getRequest();
    const admin = request.admin;

    if (!admin) {
      throw new ForbiddenException('Admin authentication required');
    }

    if (!admin.permissions.includes(requiredPermission)) {
      throw new ForbiddenException(`Permission ${requiredPermission} required`);
    }

    return true;
  }
}