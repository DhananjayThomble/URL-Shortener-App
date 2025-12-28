import { SetMetadata } from '@nestjs/common';

export const THROTTLE_KEY = 'throttle';

export interface ThrottleOptions {
  name?: string;
  ttl?: number;
  limit?: number;
}

export const Throttle = (options: ThrottleOptions) => 
  SetMetadata(THROTTLE_KEY, options);