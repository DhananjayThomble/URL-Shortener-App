import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../services/enhanced-jwt.service';

export const JwtPayload = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | any => {
    const request = ctx.switchToHttp().getRequest();
    const jwtPayload = request.jwtPayload;

    return data ? jwtPayload?.[data] : jwtPayload;
  },
);