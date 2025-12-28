import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';

import { AdminService } from './admin.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { AdminPermissionGuard } from './guards/admin-permission.guard';
import { RequirePermission } from './decorators/require-permission.decorator';
import { AdminPermission } from '../users/entities/admin-user.entity';
import { AuditLogService } from '../users/services/audit-log.service';

@ApiTags('Admin Management')
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(
    private adminService: AdminService,
    private auditLogService: AuditLogService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get admin dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Dashboard statistics retrieved successfully' })
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get('health')
  @ApiOperation({ summary: 'Get system health status' })
  @ApiResponse({ status: 200, description: 'System health status' })
  async getSystemHealth() {
    return this.adminService.getSystemHealth();
  }

  // Admin Management
  @Post('admins')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.USER_MANAGEMENT)
  @ApiOperation({ summary: 'Create new admin user' })
  @ApiResponse({ status: 201, description: 'Admin created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async createAdmin(@Body() createAdminDto: CreateAdminDto, @Request() req) {
    const admin = await this.adminService.createAdmin(createAdminDto, req.user.id);
    
    // Log the action
    await this.auditLogService.create({
      adminId: req.user.id,
      action: 'admin_created' as any,
      resource: 'admin',
      resourceId: admin.id,
      details: {
        email: createAdminDto.email,
        name: createAdminDto.name,
        permissions: createAdminDto.permissions,
      },
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.get('User-Agent'),
    });

    return {
      message: 'Admin created successfully',
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        permissions: admin.permissions,
        createdAt: admin.createdAt,
      },
    };
  }

  @Get('admins')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.USER_MANAGEMENT)
  @ApiOperation({ summary: 'Get all admin users' })
  @ApiResponse({ status: 200, description: 'Admins retrieved successfully' })
  async getAllAdmins() {
    const admins = await this.adminService.findAllAdmins();
    return {
      admins: admins.map(admin => ({
        id: admin.id,
        email: admin.email,
        name: admin.name,
        permissions: admin.permissions,
        isActive: admin.isActive,
        lastLoginAt: admin.lastLoginAt,
        createdAt: admin.createdAt,
      })),
    };
  }

  @Get('admins/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.USER_MANAGEMENT)
  @ApiOperation({ summary: 'Get admin by ID' })
  @ApiParam({ name: 'id', description: 'Admin ID' })
  @ApiResponse({ status: 200, description: 'Admin retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  async getAdminById(@Param('id') id: string) {
    const admin = await this.adminService.findAdminById(id);
    return {
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        permissions: admin.permissions,
        isActive: admin.isActive,
        lastLoginAt: admin.lastLoginAt,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
      },
    };
  }

  @Put('admins/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.USER_MANAGEMENT)
  @ApiOperation({ summary: 'Update admin user' })
  @ApiParam({ name: 'id', description: 'Admin ID' })
  @ApiResponse({ status: 200, description: 'Admin updated successfully' })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  async updateAdmin(
    @Param('id') id: string,
    @Body() updateAdminDto: UpdateAdminDto,
    @Request() req,
  ) {
    const admin = await this.adminService.updateAdmin(id, updateAdminDto, req.user.id);
    
    // Log the action
    await this.auditLogService.create({
      adminId: req.user.id,
      action: 'admin_updated' as any,
      resource: 'admin',
      resourceId: id,
      details: updateAdminDto,
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.get('User-Agent'),
    });

    return {
      message: 'Admin updated successfully',
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        permissions: admin.permissions,
        isActive: admin.isActive,
        updatedAt: admin.updatedAt,
      },
    };
  }

  @Delete('admins/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.USER_MANAGEMENT)
  @ApiOperation({ summary: 'Delete admin user' })
  @ApiParam({ name: 'id', description: 'Admin ID' })
  @ApiResponse({ status: 204, description: 'Admin deleted successfully' })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAdmin(@Param('id') id: string, @Request() req) {
    await this.adminService.deleteAdmin(id, req.user.id);
    
    // Log the action
    await this.auditLogService.create({
      adminId: req.user.id,
      action: 'admin_deleted' as any,
      resource: 'admin',
      resourceId: id,
      details: { deletedBy: req.user.email },
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.get('User-Agent'),
    });
  }

  // User Management
  @Get('users')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.USER_MANAGEMENT)
  @ApiOperation({ summary: 'Get all users' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully' })
  async getAllUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const { users, total } = await this.adminService.getAllUsers(
      parseInt(page.toString()),
      parseInt(limit.toString()),
    );

    return {
      users,
      pagination: {
        page: parseInt(page.toString()),
        limit: parseInt(limit.toString()),
        total,
        pages: Math.ceil(total / parseInt(limit.toString())),
      },
    };
  }

  @Get('users/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.USER_MANAGEMENT)
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserById(@Param('id') id: string) {
    const user = await this.adminService.getUserById(id);
    return { user };
  }

  @Post('users/:id/deactivate')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.USER_MANAGEMENT)
  @ApiOperation({ summary: 'Deactivate user account' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User deactivated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deactivateUser(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req,
  ) {
    await this.adminService.deactivateUser(id, req.user.id, reason);
    
    // Log the action
    await this.auditLogService.create({
      adminId: req.user.id,
      action: 'user_deactivated' as any,
      resource: 'user',
      resourceId: id,
      details: { reason, deactivatedBy: req.user.email },
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.get('User-Agent'),
    });

    return {
      message: 'User deactivated successfully',
    };
  }

  // Audit Logs
  @Get('audit-logs')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.AUDIT_LOGS)
  @ApiOperation({ summary: 'Get audit logs' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of logs to retrieve' })
  @ApiResponse({ status: 200, description: 'Audit logs retrieved successfully' })
  async getAuditLogs(@Query('limit') limit = 100) {
    const logs = await this.auditLogService.findAll({
      take: parseInt(limit.toString()),
    });

    return {
      logs,
      total: logs.length,
    };
  }

  @Get('audit-logs/user/:userId')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.AUDIT_LOGS)
  @ApiOperation({ summary: 'Get audit logs for specific user' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of logs to retrieve' })
  @ApiResponse({ status: 200, description: 'User audit logs retrieved successfully' })
  async getUserAuditLogs(
    @Param('userId') userId: string,
    @Query('limit') limit = 50,
  ) {
    const logs = await this.auditLogService.findByUser(
      userId,
      parseInt(limit.toString()),
    );

    return {
      logs,
      userId,
      total: logs.length,
    };
  }

  @Get('audit-logs/security')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.AUDIT_LOGS)
  @ApiOperation({ summary: 'Get security-related audit logs' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of logs to retrieve' })
  @ApiResponse({ status: 200, description: 'Security audit logs retrieved successfully' })
  async getSecurityLogs(@Query('limit') limit = 100) {
    const logs = await this.auditLogService.findSecurityEvents(
      parseInt(limit.toString()),
    );

    return {
      logs,
      total: logs.length,
    };
  }

  // System Analytics
  @Get('analytics/overview')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission(AdminPermission.ANALYTICS_VIEW)
  @ApiOperation({ summary: 'Get system analytics overview' })
  @ApiResponse({ status: 200, description: 'Analytics overview retrieved successfully' })
  async getAnalyticsOverview() {
    const stats = await this.adminService.getDashboardStats();
    
    return {
      overview: {
        totalUsers: stats.users.total,
        totalUrls: stats.urls.total,
        totalClicks: stats.urls.totalClicks,
        cacheHitRate: stats.system.cacheHitRate,
      },
      trends: {
        newUsersThisMonth: stats.users.newThisMonth,
        newUrlsThisMonth: stats.urls.createdThisMonth,
        clicksToday: stats.analytics.clicksToday,
        clicksThisWeek: stats.analytics.clicksThisWeek,
      },
      topCountries: stats.analytics.topCountries,
      topDevices: stats.analytics.topDevices,
    };
  }
}