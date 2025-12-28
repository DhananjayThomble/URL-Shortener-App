import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator';
import { VersionMigrationService } from '../services/version-migration.service';
import { ApiVersioningInterceptor } from '../interceptors/api-versioning.interceptor';

@ApiTags('utils')
@Controller('version')
export class VersionController {
  constructor(private readonly versionMigrationService: VersionMigrationService) {}

  @Get()
  @Public()
  @ApiOperation({ 
    summary: 'Get API version information',
    description: 'Returns information about supported API versions, deprecation status, and migration paths'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Version information retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        current: {
          type: 'object',
          properties: {
            version: { type: 'string', example: 'v1' },
            releaseDate: { type: 'string', format: 'date', example: '2024-01-01' },
            status: { type: 'string', enum: ['stable', 'deprecated', 'beta'], example: 'stable' },
          },
        },
        supported: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              version: { type: 'string', example: 'v1' },
              status: { type: 'string', enum: ['stable', 'deprecated', 'beta'], example: 'stable' },
              releaseDate: { type: 'string', format: 'date', example: '2024-01-01' },
              deprecationDate: { type: 'string', format: 'date', nullable: true },
              sunsetDate: { type: 'string', format: 'date', nullable: true },
              features: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        migrations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fromVersion: { type: 'string', example: 'v1' },
              toVersion: { type: 'string', example: 'v2' },
              description: { type: 'string', example: 'Migrate from v1 to v2' },
            },
          },
        },
        compatibility: {
          type: 'object',
          properties: {
            backwardCompatible: { type: 'array', items: { type: 'string' } },
            forwardCompatible: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  })
  getVersionInfo() {
    const versionConfig = ApiVersioningInterceptor.getVersionInfo();
    
    return {
      current: {
        version: versionConfig.defaultVersion,
        releaseDate: '2024-01-01',
        status: 'stable',
      },
      supported: [
        {
          version: 'v1',
          status: 'stable',
          releaseDate: '2024-01-01',
          deprecationDate: null,
          sunsetDate: null,
          features: [
            'Basic URL shortening',
            'Click analytics',
            'User management',
            'Custom aliases',
            'Link expiration',
          ],
        },
        {
          version: 'v2',
          status: 'beta',
          releaseDate: '2024-06-01',
          deprecationDate: null,
          sunsetDate: null,
          features: [
            'All v1 features',
            'Enhanced analytics',
            'Geo-targeting',
            'Password protection',
            'Bio pages',
            'Bulk operations',
            'Advanced monitoring',
          ],
        },
      ],
      migrations: this.versionMigrationService.getSupportedMigrations(),
      compatibility: this.versionMigrationService.getCompatibilityInfo(versionConfig.defaultVersion),
      headers: {
        versionHeader: versionConfig.headerName,
        queryParam: versionConfig.queryParamName,
      },
    };
  }

  @Get('compatibility/:version')
  @Public()
  @ApiOperation({ 
    summary: 'Get compatibility information for specific version',
    description: 'Returns detailed compatibility information for a specific API version'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Compatibility information retrieved successfully',
  })
  getCompatibilityInfo(@Param('version') version: string) {
    return {
      version,
      ...this.versionMigrationService.getCompatibilityInfo(version),
      canMigrateTo: this.versionMigrationService.getSupportedMigrations()
        .filter(m => m.fromVersion === version)
        .map(m => m.toVersion),
      canMigrateFrom: this.versionMigrationService.getSupportedMigrations()
        .filter(m => m.toVersion === version)
        .map(m => m.fromVersion),
    };
  }

  @Get('deprecation')
  @Public()
  @ApiOperation({ 
    summary: 'Get deprecation information',
    description: 'Returns information about deprecated API versions and sunset dates'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Deprecation information retrieved successfully',
  })
  getDeprecationInfo() {
    return {
      deprecated: [
        // Example deprecation info - would be dynamic in real implementation
        // {
        //   version: 'v1',
        //   deprecatedAt: '2024-06-01T00:00:00.000Z',
        //   sunsetAt: '2024-12-01T00:00:00.000Z',
        //   message: 'API v1 is deprecated. Please migrate to v2.',
        //   migrationGuide: 'https://docs.snapurl.com/migration/v1-to-v2',
        // }
      ],
      upcoming: [
        // Future deprecations
      ],
      policy: {
        deprecationNotice: '6 months',
        sunsetPeriod: '6 months after deprecation',
        supportPolicy: 'Security updates only for deprecated versions',
      },
    };
  }
}