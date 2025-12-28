import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { CustomDomain } from './entities/custom-domain.entity';
import { AdminUser } from './entities/admin-user.entity';
import { AuditLog } from './entities/audit-log.entity';
import { RefreshTokenService } from './entities/refresh-token.service';
import { CustomDomainService } from './services/custom-domain.service';
import { AuditLogService } from './services/audit-log.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken, CustomDomain, AdminUser, AuditLog])],
  controllers: [UsersController],
  providers: [UsersService, RefreshTokenService, CustomDomainService, AuditLogService],
  exports: [UsersService, RefreshTokenService, CustomDomainService, AuditLogService],
})
export class UsersModule {}