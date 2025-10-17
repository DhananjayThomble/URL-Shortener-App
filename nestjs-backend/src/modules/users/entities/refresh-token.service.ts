import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

import { RefreshToken } from './refresh-token.entity';

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
    private configService: ConfigService,
  ) {}

  async createRefreshToken(userId: string, token: string): Promise<RefreshToken> {
    // Hash the token before storing
    const tokenHash = this.hashToken(token);
    
    // Calculate expiration date
    const expiresIn = this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d');
    const expiresAt = this.calculateExpirationDate(expiresIn);

    // Clean up old tokens for this user
    await this.cleanupExpiredTokens(userId);

    const refreshToken = this.refreshTokenRepository.create({
      userId,
      tokenHash,
      expiresAt,
    });

    return this.refreshTokenRepository.save(refreshToken);
  }

  async validateRefreshToken(userId: string, token: string): Promise<boolean> {
    const tokenHash = this.hashToken(token);
    
    const refreshToken = await this.refreshTokenRepository.findOne({
      where: {
        userId,
        tokenHash,
        expiresAt: LessThan(new Date()),
      },
    });

    return !!refreshToken;
  }

  async revokeRefreshToken(userId: string, token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    
    await this.refreshTokenRepository.delete({
      userId,
      tokenHash,
    });
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.refreshTokenRepository.delete({ userId });
  }

  async cleanupExpiredTokens(userId?: string): Promise<void> {
    const query = this.refreshTokenRepository.createQueryBuilder()
      .delete()
      .where('expires_at < :now', { now: new Date() });

    if (userId) {
      query.andWhere('user_id = :userId', { userId });
    }

    await query.execute();
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private calculateExpirationDate(expiresIn: string): Date {
    const now = new Date();
    
    // Parse expiration string (e.g., '7d', '24h', '60m')
    const match = expiresIn.match(/^(\d+)([dhm])$/);
    if (!match) {
      throw new Error('Invalid expiration format');
    }

    const [, amount, unit] = match;
    const value = parseInt(amount, 10);

    switch (unit) {
      case 'd':
        return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
      case 'h':
        return new Date(now.getTime() + value * 60 * 60 * 1000);
      case 'm':
        return new Date(now.getTime() + value * 60 * 1000);
      default:
        throw new Error('Invalid time unit');
    }
  }
}