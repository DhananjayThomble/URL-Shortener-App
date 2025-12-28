import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { AdminService } from './admin.service';
import { AdminUser } from '../users/entities/admin-user.entity';
import { AuditLogService } from '../users/services/audit-log.service';
import { AuditAction } from '../users/entities/audit-log.entity';
import { CacheService } from '../../common/services/cache.service';

import { AdminLoginDto } from './dto/admin-login.dto';

export interface AdminLoginResponse {
  access_token: string;
  admin: {
    id: string;
    email: string;
    name: string;
    permissions: string[];
  };
}

@Injectable()
export class AdminAuthService {
  constructor(
    private adminService: AdminService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditLogService: AuditLogService,
    private cacheService: CacheService,
  ) {}

  async validateAdmin(email: string, password: string): Promise<AdminUser | null> {
    const admin = await this.adminService.findAdminByEmail(email);
    
    if (!admin) {
      return null;
    }

    if (!admin.isActive) {
      throw new UnauthorizedException('Admin account is deactivated');
    }

    const isPasswordValid = await this.adminService.validatePassword(admin, password);
    if (!isPasswordValid) {
      return null;
    }

    return admin;
  }

  async login(loginDto: AdminLoginDto, ipAddress: string, userAgent?: string): Promise<AdminLoginResponse> {
    const admin = await this.validateAdmin(loginDto.email, loginDto.password);
    
    if (!admin) {
      // Log failed login attempt
      await this.auditLogService.create({
        action: AuditAction.SECURITY_EVENT,
        resource: 'admin_auth',
        details: {
          event: 'failed_login',
          email: loginDto.email,
          reason: 'Invalid credentials',
        },
        ipAddress,
        userAgent,
      });
      
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    await this.adminService.updateLastLogin(admin.id, ipAddress);

    // Generate JWT token
    const payload = {
      sub: admin.id,
      email: admin.email,
      type: 'admin',
      permissions: admin.permissions,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_ADMIN_EXPIRES_IN', '8h'),
    });

    // Cache admin session
    const sessionData = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      permissions: admin.permissions,
      type: 'admin',
      lastLogin: new Date(),
    };

    await this.cacheService.set(
      `admin_session:${admin.id}`,
      sessionData,
      28800, // 8 hours in seconds
    );

    // Log successful login
    await this.auditLogService.create({
      adminId: admin.id,
      action: AuditAction.ADMIN_LOGIN,
      resource: 'admin_auth',
      details: {
        event: 'successful_login',
        email: admin.email,
      },
      ipAddress,
      userAgent,
    });

    return {
      access_token: accessToken,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        permissions: admin.permissions,
      },
    };
  }

  async logout(adminId: string, ipAddress: string, userAgent?: string): Promise<void> {
    // Clear admin session from cache
    await this.cacheService.del(`admin_session:${adminId}`);

    // Log logout
    await this.auditLogService.create({
      adminId,
      action: 'admin_logout' as any,
      resource: 'admin_auth',
      details: {
        event: 'logout',
      },
      ipAddress,
      userAgent,
    });
  }

  async validateJWTPayload(payload: any): Promise<AdminUser> {
    if (payload.type !== 'admin') {
      throw new UnauthorizedException('Invalid token type');
    }

    // Try to get admin from cache first
    const cachedSession = await this.cacheService.get<any>(`admin_session:${payload.sub}`);
    if (cachedSession) {
      return {
        id: cachedSession.id,
        email: cachedSession.email,
        name: cachedSession.name,
        permissions: cachedSession.permissions,
      } as AdminUser;
    }

    // Fallback to database
    const admin = await this.adminService.findAdminById(payload.sub);
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Admin not found or inactive');
    }

    return admin;
  }

  async refreshToken(adminId: string): Promise<{ access_token: string }> {
    const admin = await this.adminService.findAdminById(adminId);
    
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Admin not found or inactive');
    }

    const payload = {
      sub: admin.id,
      email: admin.email,
      type: 'admin',
      permissions: admin.permissions,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_ADMIN_EXPIRES_IN', '8h'),
    });

    return { access_token: accessToken };
  }

  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
    ipAddress: string,
    userAgent?: string,
  ): Promise<void> {
    const admin = await this.adminService.findAdminByEmail(
      (await this.adminService.findAdminById(adminId)).email,
    );

    if (!admin) {
      throw new BadRequestException('Admin not found');
    }

    // Validate current password
    const isCurrentPasswordValid = await this.adminService.validatePassword(admin, currentPassword);
    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Change password
    await this.adminService.changePassword(adminId, newPassword, adminId);

    // Log password change
    await this.auditLogService.create({
      adminId,
      action: 'admin_password_changed' as any,
      resource: 'admin_auth',
      details: {
        event: 'password_changed',
        email: admin.email,
      },
      ipAddress,
      userAgent,
    });

    // Clear admin session to force re-login
    await this.cacheService.del(`admin_session:${adminId}`);
  }
}