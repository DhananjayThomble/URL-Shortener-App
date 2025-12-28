import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

export const API_VERSION_KEY = 'apiVersion';
export const MIN_VERSION_KEY = 'minVersion';
export const MAX_VERSION_KEY = 'maxVersion';
export const DEPRECATED_VERSION_KEY = 'deprecatedVersion';

/**
 * Decorator to specify which API version(s) an endpoint supports
 * @param versions - Array of supported versions (e.g., ['v1', 'v2'])
 */
export const ApiVersion = (...versions: string[]) => SetMetadata(API_VERSION_KEY, versions);

/**
 * Decorator to specify minimum required API version
 * @param version - Minimum version required (e.g., 'v2')
 */
export const MinApiVersion = (version: string) => SetMetadata(MIN_VERSION_KEY, version);

/**
 * Decorator to specify maximum supported API version
 * @param version - Maximum version supported (e.g., 'v1')
 */
export const MaxApiVersion = (version: string) => SetMetadata(MAX_VERSION_KEY, version);

/**
 * Decorator to mark an endpoint as deprecated in specific versions
 * @param config - Deprecation configuration
 */
export const DeprecatedInVersion = (config: {
  versions: string[];
  message?: string;
  sunsetDate?: Date;
}) => SetMetadata(DEPRECATED_VERSION_KEY, config);

/**
 * Parameter decorator to get the current API version in controller methods
 */
export const CurrentApiVersion = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.apiVersion || 'v1';
  },
);

/**
 * Parameter decorator to get version-specific data
 */
export const VersionData = createParamDecorator(
  (key: string, ctx: ExecutionContext): any => {
    const request = ctx.switchToHttp().getRequest();
    const version = request.apiVersion || 'v1';
    return request.versionData?.[version]?.[key];
  },
);

/**
 * Class decorator for version-specific controllers
 * @param version - API version this controller handles
 */
export const VersionedController = (version: string) => {
  return (target: any) => {
    SetMetadata(API_VERSION_KEY, [version])(target);
    return target;
  };
};

/**
 * Method decorator for version-specific behavior
 * @param config - Version configuration
 */
export const VersionBehavior = (config: {
  [version: string]: {
    enabled?: boolean;
    deprecated?: boolean;
    message?: string;
    alternativeEndpoint?: string;
  };
}) => SetMetadata('versionBehavior', config);