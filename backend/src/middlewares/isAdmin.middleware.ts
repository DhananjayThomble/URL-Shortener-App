import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AdminService } from '../services/admin.service';

@Injectable()
export class IsAdminMiddleware implements NestMiddleware {
  constructor(private readonly adminService: AdminService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await this.adminService.findById(req.user._id);

      if (!user) {
        return res
          .status(401)
          .json({ error: 'Admin resource. Access denied' });
      }

      req.profile = user;
      next();
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Server error' });
    }
  }
}
