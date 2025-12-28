import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { EnhancedJwtService } from '../services/enhanced-jwt.service';

@Injectable()
export class EnhancedJwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private enhancedJwtService: EnhancedJwtService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Get the request object
    const request = context.switchToHttp().getRequest<Request>();
    
    // Extract token from Authorization header
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      // Verify token using enhanced JWT service (includes blacklist check)
      const payload = await this.enhancedJwtService.verifyToken(token, 'access');
      
      // Attach user info to request
      request.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}