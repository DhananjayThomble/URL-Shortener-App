import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request, Response } from 'express';

export interface ApiVersionConfig {
  defaultVersion: string;
  supportedVersions: string[];
  deprecatedVersions: Record<string, { deprecatedAt: Date; sunsetAt: Date; message?: string }>;
  headerName: string;
  queryParamName: string;
}

@Injectable()
export class ApiVersioningInterceptor implements NestInterceptor {
  private readonly config: ApiVersionConfig = {
    defaultVersion: 'v1',
    supportedVersions: ['v1', 'v2'],
    deprecatedVersions: {
      // Example: v1 will be deprecated in the future
      // 'v1': {
      //   deprecatedAt: new Date('2024-06-01'),
      //   sunsetAt: new Date('2024-12-01'),
      //   message: 'API v1 is deprecated. Please migrate to v2.'
      // }
    },
    headerName: 'X-API-Version',
    queryParamName: 'version',
  };

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Extract version from various sources
    const requestedVersion = this.extractVersion(request);
    const resolvedVersion = this.resolveVersion(requestedVersion);

    // Validate version
    if (!this.isVersionSupported(resolvedVersion)) {
      throw new BadRequestException({
        error: 'Unsupported API Version',
        message: `API version '${requestedVersion}' is not supported. Supported versions: ${this.config.supportedVersions.join(', ')}`,
        supportedVersions: this.config.supportedVersions,
        requestedVersion,
      });
    }

    // Set version in request for controllers to use
    request['apiVersion'] = resolvedVersion;

    // Add version headers to response
    response.setHeader('X-API-Version', resolvedVersion);
    response.setHeader('X-Supported-Versions', this.config.supportedVersions.join(', '));

    // Handle deprecated versions
    const deprecationInfo = this.config.deprecatedVersions[resolvedVersion];
    if (deprecationInfo) {
      response.setHeader('X-API-Deprecated', 'true');
      response.setHeader('X-API-Deprecation-Date', deprecationInfo.deprecatedAt.toISOString());
      response.setHeader('X-API-Sunset-Date', deprecationInfo.sunsetAt.toISOString());
      
      if (deprecationInfo.message) {
        response.setHeader('X-API-Deprecation-Message', deprecationInfo.message);
      }

      // Add warning header as per RFC 7234
      const warningMessage = `299 - "API version ${resolvedVersion} is deprecated. Sunset date: ${deprecationInfo.sunsetAt.toISOString()}"`;
      response.setHeader('Warning', warningMessage);
    }

    return next.handle().pipe(
      map((data) => {
        // Add version info to response body for JSON responses
        if (data && typeof data === 'object' && !Buffer.isBuffer(data)) {
          return {
            ...data,
            _meta: {
              ...data._meta,
              apiVersion: resolvedVersion,
              ...(deprecationInfo && {
                deprecation: {
                  deprecated: true,
                  deprecatedAt: deprecationInfo.deprecatedAt.toISOString(),
                  sunsetAt: deprecationInfo.sunsetAt.toISOString(),
                  message: deprecationInfo.message,
                },
              }),
            },
          };
        }
        return data;
      }),
    );
  }

  private extractVersion(request: Request): string | undefined {
    // Priority order: header > query param > URL path
    
    // 1. Check custom header
    const headerVersion = request.headers[this.config.headerName.toLowerCase()] as string;
    if (headerVersion) {
      return this.normalizeVersion(headerVersion);
    }

    // 2. Check query parameter
    const queryVersion = request.query[this.config.queryParamName] as string;
    if (queryVersion) {
      return this.normalizeVersion(queryVersion);
    }

    // 3. Extract from URL path (e.g., /api/v1/links)
    const pathMatch = request.path.match(/\/api\/(v\d+)\//);
    if (pathMatch) {
      return pathMatch[1];
    }

    return undefined;
  }

  private normalizeVersion(version: string): string {
    // Normalize version format (e.g., "1" -> "v1", "V1" -> "v1")
    const normalized = version.toLowerCase();
    if (/^\d+$/.test(normalized)) {
      return `v${normalized}`;
    }
    if (/^v\d+$/.test(normalized)) {
      return normalized;
    }
    return version;
  }

  private resolveVersion(requestedVersion?: string): string {
    return requestedVersion || this.config.defaultVersion;
  }

  private isVersionSupported(version: string): boolean {
    return this.config.supportedVersions.includes(version);
  }

  // Static method to get version info for documentation
  static getVersionInfo(): ApiVersionConfig {
    return {
      defaultVersion: 'v1',
      supportedVersions: ['v1', 'v2'],
      deprecatedVersions: {},
      headerName: 'X-API-Version',
      queryParamName: 'version',
    };
  }
}