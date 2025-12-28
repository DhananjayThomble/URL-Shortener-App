import { Injectable, Logger, BadRequestException, UnauthorizedException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

import { EmailService } from '../../../common/services/email.service';
import { UsersService } from '../../users/users.service';
import { REDIS_CLIENT } from '../../../config/redis.module';

export interface PasswordResetToken {
  userId: string;
  email: string;
  token: string;
  expiresAt: Date;
  attempts: number;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly tokenTtl = 60 * 60; // 1 hour in seconds
  private readonly maxAttempts = 5;
  private readonly requestCooldown = 15 * 60; // 15 minutes in seconds

  constructor(
    private readonly emailService: EmailService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    try {
      this.logger.debug(`Password reset requested for: ${email}`);

      // Check rate limiting
      const rateLimitKey = `password_reset_rate:${email}`;
      const attempts = await this.redis.get(rateLimitKey);
      
      if (attempts && parseInt(attempts, 10) >= this.maxAttempts) {
        const ttl = await this.redis.ttl(rateLimitKey);
        throw new BadRequestException(
          `Too many password reset attempts. Please try again in ${Math.ceil(ttl / 60)} minutes.`
        );
      }

      // Check request cooldown
      const cooldownKey = `password_reset_cooldown:${email}`;
      const cooldownExists = await this.redis.exists(cooldownKey);
      
      if (cooldownExists) {
        const ttl = await this.redis.ttl(cooldownKey);
        throw new BadRequestException(
          `Please wait ${Math.ceil(ttl / 60)} minutes before requesting another password reset.`
        );
      }

      const user = await this.usersService.findByEmail(email);
      if (!user) {
        // Don't reveal if email exists or not for security
        this.logger.warn(`Password reset requested for non-existent email: ${email}`);
        
        // Still apply rate limiting to prevent enumeration
        await this.redis.incr(rateLimitKey);
        await this.redis.expire(rateLimitKey, 60 * 60); // 1 hour
        await this.redis.setex(cooldownKey, this.requestCooldown, '1');
        
        return { message: 'If the email exists, a password reset link has been sent.' };
      }

      // Generate secure reset token
      const resetToken = this.generateResetToken();
      const expiresAt = new Date(Date.now() + this.tokenTtl * 1000);

      // Store token in Redis
      const tokenData: PasswordResetToken = {
        userId: user.id,
        email: user.email,
        token: resetToken,
        expiresAt,
        attempts: 0,
      };

      await this.redis.setex(
        `password_reset:${resetToken}`,
        this.tokenTtl,
        JSON.stringify(tokenData)
      );

      // Update rate limiting
      await this.redis.incr(rateLimitKey);
      await this.redis.expire(rateLimitKey, 60 * 60); // 1 hour

      // Set request cooldown
      await this.redis.setex(cooldownKey, this.requestCooldown, '1');

      // Also store in database as backup (existing functionality)
      const resetExpires = new Date(Date.now() + this.tokenTtl * 1000);
      await this.usersService.updatePasswordResetToken(user.id, resetToken, resetExpires);

      // Send reset email
      await this.sendPasswordResetEmail(user.email, resetToken);

      this.logger.log(`Password reset email sent to: ${user.email}`);
      return { message: 'If the email exists, a password reset link has been sent.' };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Error in requestPasswordReset for ${email}:`, error.stack);
      throw new BadRequestException('Failed to process password reset request. Please try again.');
    }
  }

  /**
   * Verify reset token
   */
  async verifyResetToken(token: string): Promise<{ valid: boolean; email?: string }> {
    try {
      if (!token) {
        return { valid: false };
      }

      // Check Redis first
      const tokenDataStr = await this.redis.get(`password_reset:${token}`);
      if (tokenDataStr) {
        const tokenData: PasswordResetToken = JSON.parse(tokenDataStr);
        
        if (new Date() <= new Date(tokenData.expiresAt)) {
          return { valid: true, email: tokenData.email };
        } else {
          // Clean up expired token
          await this.redis.del(`password_reset:${token}`);
        }
      }

      // Fallback to database check
      const user = await this.usersService.findByPasswordResetToken(token);
      if (user && user.passwordResetExpires && user.passwordResetExpires > new Date()) {
        return { valid: true, email: user.email };
      }

      return { valid: false };
    } catch (error) {
      this.logger.error(`Error verifying reset token:`, error.stack);
      return { valid: false };
    }
  }

  /**
   * Reset password using token
   */
  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    try {
      this.logger.debug(`Password reset attempt with token: ${token.substring(0, 8)}...`);

      if (!token || !newPassword) {
        throw new BadRequestException('Token and new password are required');
      }

      // Get token data from Redis
      const tokenDataStr = await this.redis.get(`password_reset:${token}`);
      let tokenData: PasswordResetToken | null = null;
      let user: any = null;

      if (tokenDataStr) {
        tokenData = JSON.parse(tokenDataStr);
        
        // Check if token is expired
        if (new Date() > new Date(tokenData.expiresAt)) {
          await this.redis.del(`password_reset:${token}`);
          throw new UnauthorizedException('Password reset token has expired');
        }

        user = await this.usersService.findById(tokenData.userId);
      } else {
        // Fallback to database check
        user = await this.usersService.findByPasswordResetToken(token);
        if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
          throw new UnauthorizedException('Invalid or expired reset token');
        }
      }

      if (!user) {
        throw new UnauthorizedException('Invalid or expired reset token');
      }

      // Validate password strength
      if (newPassword.length < 8) {
        throw new BadRequestException('Password must be at least 8 characters long');
      }

      // Check if new password is different from current
      const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
      if (isSamePassword) {
        throw new BadRequestException('New password must be different from current password');
      }

      // Hash new password
      const saltRounds = parseInt(this.configService.get('BCRYPT_SALT_ROUNDS', '12'), 10);
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      await this.usersService.updatePassword(user.id, hashedPassword);

      // Clear reset tokens from both Redis and database
      if (tokenData) {
        await this.redis.del(`password_reset:${token}`);
      }
      await this.usersService.clearPasswordResetToken(user.id);

      // Clear rate limiting for this email
      await this.redis.del(`password_reset_rate:${user.email}`);

      this.logger.log(`Password reset successful for user: ${user.email}`);
      return { message: 'Password has been reset successfully. Please log in with your new password.' };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error(`Error in resetPassword:`, error.stack);
      throw new BadRequestException('Failed to reset password. Please try again.');
    }
  }

  /**
   * Generate secure reset token
   */
  private generateResetToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Send password reset email
   */
  private async sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
    const resetUrl = `${this.configService.get('FRONTEND_URL')}/reset-password?token=${resetToken}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Password Reset - SnapURL</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #dc3545; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .button { display: inline-block; padding: 12px 24px; background: #dc3545; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
            .token { background: #e9ecef; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; }
            .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>SnapURL - Password Reset</h1>
            </div>
            <div class="content">
              <h2>Reset Your Password</h2>
              <p>You requested a password reset for your SnapURL account. Click the button below to reset your password:</p>
              <a href="${resetUrl}" class="button">Reset Password</a>
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p><a href="${resetUrl}">${resetUrl}</a></p>
              <p>Or use this reset code:</p>
              <div class="token">${resetToken}</div>
              <div class="warning">
                <strong>Security Notice:</strong>
                <ul>
                  <li>This link will expire in 1 hour</li>
                  <li>You can only use this link once</li>
                  <li>If you didn't request this reset, please ignore this email</li>
                  <li>Consider changing your password if you suspect unauthorized access</li>
                </ul>
              </div>
            </div>
            <div class="footer">
              <p>© 2025 SnapURL. All rights reserved.</p>
              <p>If you have security concerns, please contact our support team.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const text = `
      SnapURL - Password Reset
      
      You requested a password reset for your SnapURL account.
      
      Click this link to reset your password: ${resetUrl}
      
      Or use this reset code: ${resetToken}
      
      SECURITY NOTICE:
      - This link will expire in 1 hour
      - You can only use this link once
      - If you didn't request this reset, please ignore this email
      - Consider changing your password if you suspect unauthorized access
      
      If you have security concerns, please contact our support team.
    `;

    await this.emailService.sendEmail({
      to: email,
      subject: 'SnapURL - Reset Your Password',
      html,
      text,
    });
  }

  /**
   * Clean up expired tokens (called by scheduler)
   */
  async cleanupExpiredTokens(): Promise<void> {
    try {
      const keys = await this.redis.keys('password_reset:*');
      let cleanedCount = 0;

      for (const key of keys) {
        const tokenDataStr = await this.redis.get(key);
        if (tokenDataStr) {
          const tokenData: PasswordResetToken = JSON.parse(tokenDataStr);
          if (new Date() > new Date(tokenData.expiresAt)) {
            await this.redis.del(key);
            cleanedCount++;
          }
        }
      }

      if (cleanedCount > 0) {
        this.logger.debug(`Cleaned up ${cleanedCount} expired password reset tokens`);
      }
    } catch (error) {
      this.logger.error('Error cleaning up expired password reset tokens:', error.stack);
    }
  }

  /**
   * Get reset attempt status for an email
   */
  async getResetStatus(email: string): Promise<{
    canRequest: boolean;
    attemptsRemaining: number;
    nextRequestAt?: Date;
    cooldownEndsAt?: Date;
  }> {
    try {
      const rateLimitKey = `password_reset_rate:${email}`;
      const cooldownKey = `password_reset_cooldown:${email}`;

      const [attempts, rateLimitTtl, cooldownTtl] = await Promise.all([
        this.redis.get(rateLimitKey),
        this.redis.ttl(rateLimitKey),
        this.redis.ttl(cooldownKey),
      ]);

      const currentAttempts = attempts ? parseInt(attempts, 10) : 0;
      const attemptsRemaining = Math.max(0, this.maxAttempts - currentAttempts);
      const canRequest = attemptsRemaining > 0 && cooldownTtl <= 0;

      return {
        canRequest,
        attemptsRemaining,
        nextRequestAt: rateLimitTtl > 0 ? new Date(Date.now() + rateLimitTtl * 1000) : undefined,
        cooldownEndsAt: cooldownTtl > 0 ? new Date(Date.now() + cooldownTtl * 1000) : undefined,
      };
    } catch (error) {
      this.logger.error(`Error getting reset status for ${email}:`, error.stack);
      return {
        canRequest: false,
        attemptsRemaining: 0,
      };
    }
  }
}