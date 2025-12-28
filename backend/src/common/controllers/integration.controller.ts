import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../../modules/users/entities/user.entity';
import { IntegrationVerificationService } from '../services/integration-verification.service';

@ApiTags('Integration')
@Controller('integration')
export class IntegrationController {
  constructor(
    private readonly integrationService: IntegrationVerificationService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Get integration status' })
  @ApiResponse({ status: 200, description: 'Integration status retrieved successfully' })
  getIntegrationStatus() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      integration: this.integrationService.getIntegrationStatus(),
    };
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Run end-to-end integration verification' })
  @ApiResponse({ status: 200, description: 'Integration verification completed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  async runIntegrationVerification() {
    const result = await this.integrationService.verifyEndToEndFlow();
    
    return {
      status: result.success ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      verification: result,
    };
  }

  @Get('health-summary')
  @ApiOperation({ summary: 'Get comprehensive health summary' })
  @ApiResponse({ status: 200, description: 'Health summary retrieved successfully' })
  async getHealthSummary() {
    const integrationStatus = this.integrationService.getIntegrationStatus();
    const verificationResult = await this.integrationService.verifyEndToEndFlow();
    
    return {
      status: verificationResult.success ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      summary: {
        modules: {
          total: integrationStatus.modules.length,
          list: integrationStatus.modules,
        },
        services: {
          total: integrationStatus.services.length,
          list: integrationStatus.services,
        },
        middleware: {
          total: integrationStatus.middleware.length,
          list: integrationStatus.middleware,
        },
        interceptors: {
          total: integrationStatus.interceptors.length,
          list: integrationStatus.interceptors,
        },
        guards: {
          total: integrationStatus.guards.length,
          list: integrationStatus.guards,
        },
      },
      verification: verificationResult,
    };
  }
}