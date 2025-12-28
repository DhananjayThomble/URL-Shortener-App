import { User } from '../src/modules/users/entities/user.entity';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      jwtPayload?: any;
      apiVersion?: string;
    }
  }
}

export {};