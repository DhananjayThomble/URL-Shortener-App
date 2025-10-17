import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminService } from './admin.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { AdminAuthController } from './admin-auth.controller';
import { AdminGuard } from './guards/admin.guard';
import { AdminPermissionGuard } from './guards/admin-permission.guard';

// Entities
import { AdminUser } from '../users/entities/admin-user.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../users/entities/audit-log.entity';

// Schemas
import { Url, UrlSchema } from '../urls/schemas/url.schema';
import { ClickAnalytics, ClickAnalyticsSchema } from '../urls/schemas/click-analytics.schema';

// Services
import { AuditLogService } from '../users/services/audit-log.service';

@Module({
  imports: [
    // TypeORM entities
    TypeOrmModule.forFeature([AdminUser, User, AuditLog]),
    
    // Mongoose schemas
    MongooseModule.forFeature([
      { name: Url.name, schema: UrlSchema },
      { name: ClickAnalytics.name, schema: ClickAnalyticsSchema },
    ]),
    
    // JWT configuration for admin tokens
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_ADMIN_EXPIRES_IN', '8h'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AdminController, AdminAuthController],
  providers: [
    AdminService,
    AdminAuthService,
    AdminGuard,
    AdminPermissionGuard,
    AuditLogService,
  ],
  exports: [AdminService, AdminAuthService, AdminGuard, AdminPermissionGuard],
})
export class AdminModule {}