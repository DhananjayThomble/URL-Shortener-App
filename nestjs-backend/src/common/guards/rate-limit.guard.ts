import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';

@Injectable()
export class CustomRateLimitGuard extends ThrottlerGuard {
  constructor(
    options: any,
    storageService: any,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Use user ID if authenticated, otherwise fall back to IP
    const userId = req.user?.id;
    if (userId) {
      return `user:${userId}`;
    }
    
    // Get real IP address considering proxies
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.connection.remoteAddress;
    return `ip:${ip}`;
  }

  protected async throwThrottlingException(context: ExecutionContext): Promise<void> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    
    // Add rate limit headers
    const resetTime = Math.ceil(Date.now() / 1000) + 60; // Reset in 1 minute
    response.header('X-RateLimit-Limit', '100');
    response.header('X-RateLimit-Remaining', '0');
    response.header('X-RateLimit-Reset', resetTime.toString());
    
    throw new ThrottlerException('Rate limit exceeded. Please try again later.');
  }
}