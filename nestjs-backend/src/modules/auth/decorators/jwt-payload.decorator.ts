import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload as JwtPayloadInterface } from '../services/enhanced-jwt.service';

export const JwtPayload = createParamDecorator(
  (data: keyof JwtPayloadInterface | undefined, ctx: ExecutionContext): JwtPayloadInterface | any => {
    const request = ctx.switchToHttp().getRequest();
    const jwtPayload = request.jwtPayload;

    return data ? jwtPayload?.[data] : jwtPayload;
  },
);