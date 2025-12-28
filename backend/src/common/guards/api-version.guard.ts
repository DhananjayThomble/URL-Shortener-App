import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  API_VERSION_KEY,
  MIN_VERSION_KEY,
  MAX_VERSION_KEY,
  DEPRECATED_VERSION_KEY,
} from '../decorators/api-version.decorator';

@Injectable()
export class ApiVersionGuard implements CanActivate {
  private readonly logger = new Logger(ApiVersionGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const currentVersion = request.apiVersion || 'v1';

    // Get version metadata from controller and handler
    const controllerVersions = this.reflector.get<string[]>(
      API_VERSION_KEY,
      context.getClass(),
    );
    const handlerVersions = this.reflector.get<string[]>(
      API_VERSION_KEY,
      context.getHandler(),
    );
    const minVersion = this.reflector.get<string>(
      MIN_VERSION_KEY,
      context.getHandler(),
    );
    const maxVersion = this.reflector.get<string>(
      MAX_VERSION_KEY,
      context.getHandler(),
    );
    const deprecatedConfig = this.reflector.get<{
      versions: string[];
      message?: string;
      sunsetDate?: Date;
    }>(DEPRECATED_VERSION_KEY, context.getHandler());

    // Combine versions from controller and handler
    const supportedVersions = [
      ...(controllerVersions || []),
      ...(handlerVersions || []),
    ];

    // If no version constraints are specified, allow all versions
    if (
      !supportedVersions.length &&
      !minVersion &&
      !maxVersion &&
      !deprecatedConfig
    ) {
      return true;
    }

    // Check if current version is in supported versions list
    if (supportedVersions.length > 0 && !supportedVersions.includes(currentVersion)) {
      throw new BadRequestException({
        error: 'Unsupported API Version',
        message: `This endpoint does not support API version '${currentVersion}'. Supported versions: ${supportedVersions.join(', ')}`,
        supportedVersions,
        currentVersion,
        endpoint: `${request.method} ${request.path}`,
      });
    }

    // Check minimum version requirement
    if (minVersion && this.compareVersions(currentVersion, minVersion) < 0) {
      throw new BadRequestException({
        error: 'API Version Too Old',
        message: `This endpoint requires API version '${minVersion}' or higher. Current version: '${currentVersion}'`,
        minVersion,
        currentVersion,
        endpoint: `${request.method} ${request.path}`,
      });
    }

    // Check maximum version constraint
    if (maxVersion && this.compareVersions(currentVersion, maxVersion) > 0) {
      throw new BadRequestException({
        error: 'API Version Too New',
        message: `This endpoint only supports API version '${maxVersion}' or lower. Current version: '${currentVersion}'`,
        maxVersion,
        currentVersion,
        endpoint: `${request.method} ${request.path}`,
      });
    }

    // Handle deprecated versions
    if (deprecatedConfig && deprecatedConfig.versions.includes(currentVersion)) {
      const message = deprecatedConfig.message || 
        `API version '${currentVersion}' is deprecated for this endpoint`;
      
      // Add deprecation headers
      response.setHeader('X-Endpoint-Deprecated', 'true');
      response.setHeader('X-Deprecation-Message', message);
      
      if (deprecatedConfig.sunsetDate) {
        response.setHeader('X-Sunset-Date', deprecatedConfig.sunsetDate.toISOString());
      }

      // Log deprecation usage for monitoring
      this.logger.warn(
        `Deprecated API version used: ${currentVersion} for ${request.method} ${request.path}`,
        {
          version: currentVersion,
          endpoint: `${request.method} ${request.path}`,
          userAgent: request.get('User-Agent'),
          ip: request.ip,
          deprecationMessage: message,
        },
      );
    }

    return true;
  }

  private compareVersions(version1: string, version2: string): number {
    // Extract numeric part from version strings (e.g., 'v1' -> 1)
    const v1 = parseInt(version1.replace(/^v/, ''), 10);
    const v2 = parseInt(version2.replace(/^v/, ''), 10);

    if (v1 < v2) return -1;
    if (v1 > v2) return 1;
    return 0;
  }
}