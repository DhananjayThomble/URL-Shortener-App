import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Generate unique request ID for tracing
    const requestId = req.headers['x-request-id'] as string || uuidv4();
    
    // Add to request object
    req['requestId'] = requestId;
    
    // Add to response headers
    res.setHeader('X-Request-ID', requestId);
    
    next();
  }
}