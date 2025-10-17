import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';

import { AdminUser, AdminPermission } from '../users/entities/admin-user.entity';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from '../users/services/audit-log.service';
import { CacheService } from '../../common/services/cache.service';
import { Url, UrlDocument } from '../urls/schemas/url.schema';
import { ClickAnalytics, ClickAnalyticsDocument } from '../urls/schemas/click-analytics.schema';

import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';

export interface AdminDashboardStats {
  users: {
    total: number;
    active: number;
    newThisMonth: number;
    verifiedEmails: number;
  };
  urls: {
    total: number;
    active: number;
    createdThisMonth: number;
    totalClicks: number;
  };
  system: {
    cacheHitRate: number;
    avgResponseTime: number;
    errorRate: number;
    uptime: string;
  };
  analytics: {
    topCountries: Array<{ country: string; count: number }>;
    topDevices: Array<{ device: string; count: number }>;
    clicksToday: number;
    clicksThisWeek: number;
  };
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(AdminUser)
    private adminRepository: Repository<AdminUser>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectModel(Url.name)
    private urlModel: Model<UrlDocument>,
    @InjectModel(ClickAnalytics.name)
    private clickAnalyticsModel: Model<ClickAnalyticsDocument>,
    private auditLogService: AuditLogService,
    private cacheService: CacheService,
  ) {}

  async createAdmin(createAdminDto: CreateAdminDto, createdByAdminId: string): Promise<AdminUser> {
    // Check if admin with email already exists
    const existingAdmin = await this.adminRepository.findOne({
      where: { email: createAdminDto.email },
    });

    if (existingAdmin) {
      throw new BadRequestException('Admin with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(createAdminDto.password, 12);

    const admin = this.adminRepository.create({
      email: createAdminDto.email,
      passwordHash,
      name: createAdminDto.name,
      permissions: createAdminDto.permissions,
    });

    const savedAdmin = await this.adminRepository.save(admin);

    // Log admin creation
    await this.auditLogService.create({
      adminId: createdByAdminId,
      action: 'admin_created' as any,
      resource: 'admin',
      resourceId: savedAdmin.id,
      details: {
        email: createAdminDto.email,
        name: createAdminDto.name,
        permissions: createAdminDto.permissions,
      },
      ipAddress: '0.0.0.0', // This should be passed from the controller
    });

    return savedAdmin;
  }

  async findAllAdmins(options?: FindManyOptions<AdminUser>): Promise<AdminUser[]> {
    return this.adminRepository.find({
      select: ['id', 'email', 'name', 'permissions', 'isActive', 'lastLoginAt', 'createdAt', 'updatedAt'],
      order: { createdAt: 'DESC' },
      ...options,
    });
  }

  async findAdminById(id: string): Promise<AdminUser> {
    const admin = await this.adminRepository.findOne({
      where: { id },
      select: ['id', 'email', 'name', 'permissions', 'isActive', 'lastLoginAt', 'createdAt', 'updatedAt'],
    });

    if (!admin) {
      throw new NotFoundException(`Admin with ID ${id} not found`);
    }

    return admin;
  }

  async findAdminByEmail(email: string): Promise<AdminUser | null> {
    return this.adminRepository.findOne({
      where: { email },
      select: ['id', 'email', 'name', 'passwordHash', 'permissions', 'isActive', 'lastLoginAt', 'createdAt', 'updatedAt'],
    });
  }

  async updateAdmin(id: string, updateAdminDto: UpdateAdminDto, updatedByAdminId: string): Promise<AdminUser> {
    const admin = await this.findAdminById(id);

    Object.assign(admin, updateAdminDto);
    const updatedAdmin = await this.adminRepository.save(admin);

    // Log admin update
    await this.auditLogService.create({
      adminId: updatedByAdminId,
      action: 'admin_updated' as any,
      resource: 'admin',
      resourceId: id,
      details: updateAdminDto,
      ipAddress: '0.0.0.0', // This should be passed from the controller
    });

    return updatedAdmin;
  }

  async deleteAdmin(id: string, deletedByAdminId: string): Promise<void> {
    const admin = await this.findAdminById(id);

    // Prevent self-deletion
    if (id === deletedByAdminId) {
      throw new BadRequestException('Cannot delete your own admin account');
    }

    await this.adminRepository.remove(admin);

    // Log admin deletion
    await this.auditLogService.create({
      adminId: deletedByAdminId,
      action: 'admin_deleted' as any,
      resource: 'admin',
      resourceId: id,
      details: {
        email: admin.email,
        name: admin.name,
      },
      ipAddress: '0.0.0.0', // This should be passed from the controller
    });
  }

  async updateLastLogin(id: string, ipAddress: string): Promise<void> {
    await this.adminRepository.update(id, {
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress,
    });
  }

  async validatePassword(admin: AdminUser, password: string): Promise<boolean> {
    return bcrypt.compare(password, admin.passwordHash);
  }

  async changePassword(id: string, newPassword: string, changedByAdminId: string): Promise<void> {
    const admin = await this.findAdminById(id);
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.adminRepository.update(id, { passwordHash });

    // Log password change
    await this.auditLogService.create({
      adminId: changedByAdminId,
      action: 'admin_password_changed' as any,
      resource: 'admin',
      resourceId: id,
      details: {
        targetAdmin: admin.email,
      },
      ipAddress: '0.0.0.0', // This should be passed from the controller
    });
  }

  async hasPermission(adminId: string, permission: AdminPermission): Promise<boolean> {
    const admin = await this.findAdminById(adminId);
    return admin.permissions.includes(permission);
  }

  async requirePermission(adminId: string, permission: AdminPermission): Promise<void> {
    const hasPermission = await this.hasPermission(adminId, permission);
    if (!hasPermission) {
      throw new ForbiddenException(`Admin does not have ${permission} permission`);
    }
  }

  // User Management Methods
  async getAllUsers(page = 1, limit = 20): Promise<{ users: User[]; total: number }> {
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.userRepository.find({
        select: ['id', 'email', 'name', 'isEmailVerified', 'role', 'createdAt', 'updatedAt'],
        skip,
        take: limit,
        order: { createdAt: 'DESC' },
      }),
      this.userRepository.count(),
    ]);

    return { users, total };
  }

  async getUserById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      select: ['id', 'email', 'name', 'isEmailVerified', 'role', 'createdAt', 'updatedAt'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async deactivateUser(userId: string, adminId: string, reason?: string): Promise<void> {
    const user = await this.getUserById(userId);
    
    // In a real implementation, you might have an isActive field
    // For now, we'll log the deactivation
    await this.auditLogService.create({
      adminId,
      action: 'user_deactivated' as any,
      resource: 'user',
      resourceId: userId,
      details: {
        userEmail: user.email,
        reason,
      },
      ipAddress: '0.0.0.0',
    });

    // Clear user cache
    await this.cacheService.invalidateUserCache(userId);
  }

  async getDashboardStats(): Promise<AdminDashboardStats> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // User statistics
    const [totalUsers, activeUsers, newUsersThisMonth, verifiedUsers] = await Promise.all([
      this.userRepository.count(),
      this.userRepository.count({ where: { isEmailVerified: true } }),
      this.userRepository.count({ where: { createdAt: { $gte: startOfMonth } as any } }),
      this.userRepository.count({ where: { isEmailVerified: true } }),
    ]);

    // URL statistics
    const [totalUrls, activeUrls, newUrlsThisMonth] = await Promise.all([
      this.urlModel.countDocuments(),
      this.urlModel.countDocuments({ isActive: true }),
      this.urlModel.countDocuments({ createdAt: { $gte: startOfMonth } }),
    ]);

    // Click statistics
    const [totalClicks, clicksToday, clicksThisWeek] = await Promise.all([
      this.clickAnalyticsModel.countDocuments(),
      this.clickAnalyticsModel.countDocuments({ timestamp: { $gte: startOfDay } }),
      this.clickAnalyticsModel.countDocuments({ timestamp: { $gte: startOfWeek } }),
    ]);

    // Top countries
    const topCountries = await this.clickAnalyticsModel.aggregate([
      { $match: { timestamp: { $gte: startOfWeek } } },
      { $group: { _id: '$country', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $project: { country: '$_id', count: 1, _id: 0 } },
    ]);

    // Top devices
    const topDevices = await this.clickAnalyticsModel.aggregate([
      { $match: { timestamp: { $gte: startOfWeek } } },
      { $group: { _id: '$device', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $project: { device: '$_id', count: 1, _id: 0 } },
    ]);

    // Cache statistics
    const cacheStats = await this.cacheService.getStats();
    const cacheHitRate = cacheStats.hits + cacheStats.misses > 0 
      ? (cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100 
      : 0;

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        newThisMonth: newUsersThisMonth,
        verifiedEmails: verifiedUsers,
      },
      urls: {
        total: totalUrls,
        active: activeUrls,
        createdThisMonth: newUrlsThisMonth,
        totalClicks: totalClicks,
      },
      system: {
        cacheHitRate: Math.round(cacheHitRate * 100) / 100,
        avgResponseTime: 0, // Would be implemented with performance monitoring
        errorRate: 0, // Would be implemented with error tracking
        uptime: process.uptime().toString(),
      },
      analytics: {
        topCountries,
        topDevices,
        clicksToday,
        clicksThisWeek,
      },
    };
  }

  async getSystemHealth(): Promise<{
    database: { postgres: boolean; mongodb: boolean };
    cache: boolean;
    services: { [key: string]: boolean };
  }> {
    const [postgresHealth, cacheHealth] = await Promise.all([
      this.checkPostgresHealth(),
      this.cacheService.healthCheck(),
    ]);

    const mongoHealth = await this.checkMongoHealth();

    return {
      database: {
        postgres: postgresHealth,
        mongodb: mongoHealth,
      },
      cache: cacheHealth,
      services: {
        audit: true, // Could implement actual health checks
        email: true, // Could implement actual health checks
      },
    };
  }

  private async checkPostgresHealth(): Promise<boolean> {
    try {
      await this.userRepository.query('SELECT 1');
      return true;
    } catch (error) {
      return false;
    }
  }

  private async checkMongoHealth(): Promise<boolean> {
    try {
      await this.urlModel.findOne().limit(1);
      return true;
    } catch (error) {
      return false;
    }
  }
}