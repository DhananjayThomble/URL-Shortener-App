import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { HttpCachingService } from '../services/http-caching.service';

@Injectable()
export class StaticCacheMiddleware implements NestMiddleware {
  private readonly logger = new Logger(StaticCacheMiddleware.name);

  constructor(private readonly httpCachingService: HttpCachingService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const url = req.url;
    const method = req.method;

    // Only apply to GET requests
    if (method !== 'GET') {
      return next();
    }

    // Check if this is a static resource request
    const resourceType = this.getResourceType(url);
    if (!resourceType) {
      return next();
    }

    try {
      // Apply appropriate caching headers
      this.httpCachingService.applyStaticResourceCaching(res, resourceType);
      
      // Set additional headers for static resources
      this.setStaticResourceHeaders(res, resourceType);
      
      this.logger.debug(`Applied static caching for ${resourceType}: ${url}`);
    } catch (error) {
      this.logger.error('Failed to apply static resource caching:', error);
    }

    next();
  }

  private getResourceType(url: string): 'image' | 'css' | 'js' | 'font' | null {
    const extension = this.getFileExtension(url);
    
    const typeMap: Record<string, 'image' | 'css' | 'js' | 'font'> = {
      // Images
      'jpg': 'image',
      'jpeg': 'image',
      'png': 'image',
      'gif': 'image',
      'webp': 'image',
      'svg': 'image',
      'ico': 'image',
      'bmp': 'image',
      'tiff': 'image',
      
      // CSS
      'css': 'css',
      
      // JavaScript
      'js': 'js',
      'mjs': 'js',
      'jsx': 'js',
      'ts': 'js',
      'tsx': 'js',
      
      // Fonts
      'woff': 'font',
      'woff2': 'font',
      'ttf': 'font',
      'otf': 'font',
      'eot': 'font',
    };

    return typeMap[extension] || null;
  }

  private getFileExtension(url: string): string {
    // Remove query parameters and hash
    const cleanUrl = url.split('?')[0].split('#')[0];
    const parts = cleanUrl.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  }

  private setStaticResourceHeaders(res: Response, resourceType: string): void {
    // Set appropriate Content-Type headers
    const contentTypes: Record<string, string> = {
      'image': 'image/*',
      'css': 'text/css',
      'js': 'application/javascript',
      'font': 'font/*',
    };

    // Set security headers for static resources
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Set CORS headers for fonts and other cross-origin resources
    if (resourceType === 'font') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    // Set compression hint
    res.setHeader('Vary', 'Accept-Encoding');
  }
}