import { Controller, Post, Get, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

import { MigrationService } from './migration.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../modules/users/entities/user.entity';

@ApiTags('migration')
@Controller('migration')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class MigrationController {
  constructor(private readonly migrationService: MigrationService) {}

  @Post('start')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Start migration from Express.js app' })
  @ApiResponse({ status: 200, description: 'Migration started successfully' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async startMigration() {
    return this.migrationService.migrateFromExpressApp();
  }

  @Get('status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get migration status' })
  @ApiResponse({ status: 200, description: 'Migration status retrieved' })
  async getMigrationStatus() {
    return this.migrationService.getMigrationStatus();
  }

  @Delete('rollback')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Rollback migration' })
  @ApiResponse({ status: 200, description: 'Migration rolled back successfully' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async rollbackMigration() {
    await this.migrationService.rollbackMigration();
    return { message: 'Migration rolled back successfully' };
  }
}