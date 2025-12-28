import { Injectable, Logger, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { REDIS_CLIENT } from '../../../config/redis.module';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
  jti?: string; // JWT ID for blacklisting
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpires: Date;
  refreshTokenExpires: Date;
}

@Injectable()
export class EnhancedJwtService {
  private readonly logger = new Logger(EnhancedJwtService.name);
  private readonly accessTokenTtl: number;
  private readonly refreshTokenTtl: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    // Parse TTL values from config
    this.accessTokenTtl = this.parseTimeToSeconds(
      this.configService.get('JWT_EXPIRES_IN', '15m')
    );
    this.refreshTokenTtl = this.parseTimeToSeconds(
      this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d')
    );
  }

  /**
   * Generate both access and refresh tokens
   */
  async generateTokenPair(payload: Omit<JwtPayload, 'type' | 'jti'>): Promise<TokenPair> {
    const accessTokenId = this.generateTokenId();
    const refreshTokenId = this.generateTokenId();

    const accessTokenPayload: JwtPayload = {
      ...payload,
      type: 'access',
      jti: accessTokenId,
    };

    const refreshTokenPayload: JwtPayload = {
      ...payload,
      type: 'refresh',
      jti: refreshTokenId,
    };

    const accessToken = this.jwtService.sign(accessTokenPayload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: this.configService.get('JWT_EXPIRES_IN', '15m'),
    });

    const refreshToken = this.jwtService.sign(refreshTokenPayload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    const now = new Date();
    const accessTokenExpires = new Date(now.getTime() + this.accessTokenTtl * 1000);
    const refreshTokenExpires = new Date(now.getTime() + this.refreshTokenTtl * 1000);

    // Store token metadata in Redis for tracking
    await this.storeTokenMetadata(payload.sub, accessTokenId, 'access', accessTokenExpires);
    await this.storeTokenMetadata(payload.sub, refreshTokenId, 'refresh', refreshTokenExpires);

    this.logger.debug(`Generated token pair for user: ${payload.sub}`);

    return {
      accessToken,
      refreshToken,
      accessTokenExpires,
      refreshTokenExpires,
    };
  }

  /**
   * Verify and decode a JWT token
   */
  async verifyToken(token: string, type: 'access' | 'refresh'): Promise<JwtPayload> {
    try {
      const secret = type === 'access' 
        ? this.configService.get('JWT_SECRET')
        : this.configService.get('JWT_REFRESH_SECRET');

      const payload = this.jwtService.verify(token, { secret }) as JwtPayload;

      // Check if token is blacklisted
      if (await this.isTokenBlacklisted(payload.jti)) {
        this.logger.warn(`Blacklisted token used: ${payload.jti}`);
        throw new UnauthorizedException('Token has been revoked');
      }

      // Verify token type matches expected type
      if (payload.type !== type) {
        this.logger.warn(`Token type mismatch. Expected: ${type}, Got: ${payload.type}`);
        throw new UnauthorizedException('Invalid token type');
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      
      this.logger.warn(`Token verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; accessTokenExpires: Date }> {
    const refreshPayload = await this.verifyToken(refreshToken, 'refresh');

    // Generate new access token
    const accessTokenId = this.generateTokenId();
    const accessTokenPayload: JwtPayload = {
      sub: refreshPayload.sub,
      email: refreshPayload.email,
      role: refreshPayload.role,
      type: 'access',
      jti: accessTokenId,
    };

    const accessToken = this.jwtService.sign(accessTokenPayload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: this.configService.get('JWT_EXPIRES_IN', '15m'),
    });

    const accessTokenExpires = new Date(Date.now() + this.accessTokenTtl * 1000);

    // Store new access token metadata
    await this.storeTokenMetadata(refreshPayload.sub, accessTokenId, 'access', accessTokenExpires);

    this.logger.debug(`Refreshed access token for user: ${refreshPayload.sub}`);

    return { accessToken, accessTokenExpires };
  }

  /**
   * Blacklist a specific token
   */
  async blacklistToken(token: string): Promise<void> {
    try {
      const payload = this.jwtService.decode(token) as JwtPayload;
      if (!payload || !payload.jti) {
        this.logger.warn('Cannot blacklist token without JTI');
        return;
      }

      const ttl = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : this.accessTokenTtl;
      
      if (ttl > 0) {
        await this.redis.setex(`blacklist:${payload.jti}`, ttl, '1');
        this.logger.debug(`Blacklisted token: ${payload.jti}`);
      }
    } catch (error) {
      this.logger.error(`Error blacklisting token: ${error.message}`);
    }
  }

  /**
   * Blacklist all tokens for a user
   */
  async blacklistAllUserTokens(userId: string): Promise<void> {
    try {
      // Get all active tokens for the user
      const tokenKeys = await this.redis.keys(`token:${userId}:*`);
      
      const pipeline = this.redis.pipeline();
      
      for (const key of tokenKeys) {
        const tokenData = await this.redis.get(key);
        if (tokenData) {
          const { tokenId, type, expiresAt } = JSON.parse(tokenData);
          const ttl = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
          
          if (ttl > 0) {
            pipeline.setex(`blacklist:${tokenId}`, ttl, '1');
          }
        }
        
        // Remove token metadata
        pipeline.del(key);
      }
      
      await pipeline.exec();
      
      this.logger.log(`Blacklisted all tokens for user: ${userId}`);
    } catch (error) {
      this.logger.error(`Error blacklisting user tokens: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if a token is blacklisted
   */
  private async isTokenBlacklisted(tokenId: string): Promise<boolean> {
    if (!tokenId) return false;
    
    try {
      const result = await this.redis.get(`blacklist:${tokenId}`);
      return result === '1';
    } catch (error) {
      this.logger.error(`Error checking blacklist: ${error.message}`);
      return false;
    }
  }

  /**
   * Store token metadata in Redis
   */
  private async storeTokenMetadata(
    userId: string, 
    tokenId: string, 
    type: 'access' | 'refresh', 
    expiresAt: Date
  ): Promise<void> {
    const key = `token:${userId}:${tokenId}`;
    const data = {
      tokenId,
      type,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    };

    const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    
    if (ttl > 0) {
      await this.redis.setex(key, ttl, JSON.stringify(data));
    }
  }

  /**
   * Generate a unique token ID
   */
  private generateTokenId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Parse time string to seconds
   */
  private parseTimeToSeconds(timeStr: string): number {
    const match = timeStr.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error(`Invalid time format: ${timeStr}`);
    }

    const [, amount, unit] = match;
    const value = parseInt(amount, 10);

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 24 * 60 * 60;
      default: throw new Error(`Invalid time unit: ${unit}`);
    }
  }

  /**
   * Get active tokens for a user
   */
  async getUserActiveTokens(userId: string): Promise<Array<{
    tokenId: string;
    type: 'access' | 'refresh';
    expiresAt: string;
    createdAt: string;
  }>> {
    try {
      const tokenKeys = await this.redis.keys(`token:${userId}:*`);
      const tokens = [];

      for (const key of tokenKeys) {
        const tokenData = await this.redis.get(key);
        if (tokenData) {
          tokens.push(JSON.parse(tokenData));
        }
      }

      return tokens;
    } catch (error) {
      this.logger.error(`Error getting user tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Clean up expired token metadata
   */
  async cleanupExpiredTokens(): Promise<void> {
    try {
      // Redis automatically expires keys, but we can clean up any orphaned blacklist entries
      const blacklistKeys = await this.redis.keys('blacklist:*');
      
      for (const key of blacklistKeys) {
        const ttl = await this.redis.ttl(key);
        if (ttl === -1) { // Key exists but has no expiration
          await this.redis.del(key);
        }
      }

      this.logger.debug('Cleaned up expired token metadata');
    } catch (error) {
      this.logger.error(`Error cleaning up tokens: ${error.message}`);
    }
  }
}