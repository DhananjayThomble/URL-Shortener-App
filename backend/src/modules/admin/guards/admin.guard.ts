import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AdminUser } from '../../users/entities/admin-user.entity';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @InjectRepository(AdminUser)
    private adminRepository: Repository<AdminUser>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // Check if user is an admin
    const admin = await this.adminRepository.findOne({
      where: { email: user.email, isActive: true },
      select: ['id', 'email', 'permissions', 'isActive'],
    });

    if (!admin) {
      throw new ForbiddenException('Admin access required');
    }

    // Attach admin info to request
    request.admin = admin;
    
    return true;
  }
}