import { Injectable, Logger, BadRequestException, UnauthorizedException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as crypto from 'crypto';

import { EmailService } from '../../../common/services/email.service';
import { UsersService } from '../../users/users.service';
import { REDIS_CLIENT } from '../../../config/redis.module';

export interface EmailVerificationToken {
  userId: string;
  email: string;
  token: string;
  expiresAt: Date;
  attempts: number;
}

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  private readonly tokenTtl = 24 * 60 * 60; // 24 hours in seconds
  private readonly maxAttempts = 5;
  private readonly resendCooldown = 5 * 60; // 5 minutes in seconds

  constructor(
    private readonly emailService: EmailService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Generate and send email verification token
   */
  async sendVerificationEmail(userId: string, email: string): Promise<{ message: string }> {
    try {
      // Check if user exists and is not already verified
      const user = await this.usersService.findById(userId);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      if (user.isEmailVerified) {
        return { message: 'Email is already verified' };
      }

      // Check rate limiting
      const rateLimitKey = `email_verification_rate:${email}`;
      const attempts = await this.redis.get(rateLimitKey);
      
      if (attempts && parseInt(attempts, 10) >= this.maxAttempts) {
        const ttl = await this.redis.ttl(rateLimitKey);
        throw new BadRequestException(
          `Too many verification attempts. Please try again in ${Math.ceil(ttl / 60)} minutes.`
        );
      }

      // Check resend cooldown
      const cooldownKey = `email_verification_cooldown:${email}`;
      const cooldownExists = await this.redis.exists(cooldownKey);
      
      if (cooldownExists) {
        const ttl = await this.redis.ttl(cooldownKey);
        throw new BadRequestException(
          `Please wait ${Math.ceil(ttl / 60)} minutes before requesting another verification email.`
        );
      }

      // Generate verification token
      const token = this.generateVerificationToken();
      const expiresAt = new Date(Date.now() + this.tokenTtl * 1000);

      // Store token in Redis
      const tokenData: EmailVerificationToken = {
        userId,
        email,
        token,
        expiresAt,
        attempts: 0,
      };

      await this.redis.setex(
        `email_verification:${token}`,
        this.tokenTtl,
        JSON.stringify(tokenData)
      );

      // Update rate limiting
      await this.redis.incr(rateLimitKey);
      await this.redis.expire(rateLimitKey, 60 * 60); // 1 hour

      // Set resend cooldown
      await this.redis.setex(cooldownKey, this.resendCooldown, '1');

      // Send verification email
      await this.sendVerificationEmailTemplate(email, token);

      this.logger.log(`Verification email sent to: ${email}`);
      return { message: 'Verification email sent successfully' };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Error sending verification email to ${email}:`, error.stack);
      throw new BadRequestException('Failed to send verification email. Please try again.');
    }
  }

  /**
   * Verify email using token
   */
  async verifyEmail(token: string): Promise<{ message: string; user?: any }> {
    try {
      if (!token) {
        throw new BadRequestException('Verification token is required');
      }

      // Get token data from Redis
      const tokenDataStr = await this.redis.get(`email_verification:${token}`);
      if (!tokenDataStr) {
        throw new UnauthorizedException('Invalid or expired verification token');
      }

      const tokenData: EmailVerificationToken = JSON.parse(tokenDataStr);

      // Check if token is expired
      if (new Date() > new Date(tokenData.expiresAt)) {
        await this.redis.del(`email_verification:${token}`);
        throw new UnauthorizedException('Verification token has expired');
      }

      // Verify user exists
      const user = await this.usersService.findById(tokenData.userId);
      if (!user) {
        await this.redis.del(`email_verification:${token}`);
        throw new BadRequestException('User not found');
      }

      // Check if email matches
      if (user.email !== tokenData.email) {
        await this.redis.del(`email_verification:${token}`);
        throw new BadRequestException('Email mismatch');
      }

      // Check if already verified
      if (user.isEmailVerified) {
        await this.redis.del(`email_verification:${token}`);
        return { message: 'Email is already verified' };
      }

      // Mark email as verified
      await this.usersService.markEmailAsVerified(user.id);

      // Clean up token
      await this.redis.del(`email_verification:${token}`);

      // Clear rate limiting for this email
      await this.redis.del(`email_verification_rate:${tokenData.email}`);

      this.logger.log(`Email verified successfully for user: ${user.email}`);

      return {
        message: 'Email verified successfully',
        user: {
          id: user.id,
          email: user.email,
          isEmailVerified: true,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error(`Error verifying email with token ${token}:`, error.stack);
      throw new BadRequestException('Failed to verify email. Please try again.');
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string): Promise<{ message: string }> {
    try {
      const user = await this.usersService.findByEmail(email);
      if (!user) {
        // Don't reveal if email exists or not
        return { message: 'If the email exists and is not verified, a verification email has been sent.' };
      }

      if (user.isEmailVerified) {
        return { message: 'Email is already verified' };
      }

      return this.sendVerificationEmail(user.id, email);
    } catch (error) {
      this.logger.error(`Error resending verification email to ${email}:`, error.stack);
      return { message: 'If the email exists and is not verified, a verification email has been sent.' };
    }
  }

  /**
   * Check verification status
   */
  async getVerificationStatus(userId: string): Promise<{
    isVerified: boolean;
    email: string;
    canResend: boolean;
    nextResendAt?: Date;
  }> {
    try {
      const user = await this.usersService.findById(userId);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      const cooldownKey = `email_verification_cooldown:${user.email}`;
      const cooldownTtl = await this.redis.ttl(cooldownKey);
      
      return {
        isVerified: user.isEmailVerified,
        email: user.email,
        canResend: cooldownTtl <= 0,
        nextResendAt: cooldownTtl > 0 ? new Date(Date.now() + cooldownTtl * 1000) : undefined,
      };
    } catch (error) {
      this.logger.error(`Error getting verification status for user ${userId}:`, error.stack);
      throw new BadRequestException('Failed to get verification status');
    }
  }

  /**
   * Generate secure verification token
   */
  private generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Send verification email template
   */
  private async sendVerificationEmailTemplate(email: string, token: string): Promise<void> {
    const verificationUrl = `${this.configService.get('FRONTEND_URL')}/verify-email?token=${token}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Email Verification - SnapURL</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #28a745; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .button { display: inline-block; padding: 12px 24px; background: #28a745; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
            .token { background: #e9ecef; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>SnapURL - Email Verification</h1>
            </div>
            <div class="content">
              <h2>Verify Your Email Address</h2>
              <p>Welcome to SnapURL! Please verify your email address to complete your account setup.</p>
              <a href="${verificationUrl}" class="button">Verify Email Address</a>
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p><a href="${verificationUrl}">${verificationUrl}</a></p>
              <p>Or use this verification code:</p>
              <div class="token">${token}</div>
              <p><strong>This verification link will expire in 24 hours.</strong></p>
              <p>If you didn't create an account with SnapURL, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>© 2025 SnapURL. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const text = `
      SnapURL - Email Verification
      
      Welcome to SnapURL! Please verify your email address to complete your account setup.
      
      Click this link to verify your email: ${verificationUrl}
      
      Or use this verification code: ${token}
      
      This verification link will expire in 24 hours.
      
      If you didn't create an account with SnapURL, please ignore this email.
    `;

    await this.emailService.sendEmail({
      to: email,
      subject: 'SnapURL - Verify Your Email Address',
      html,
      text,
    });
  }

  /**
   * Clean up expired tokens (called by scheduler)
   */
  async cleanupExpiredTokens(): Promise<void> {
    try {
      const keys = await this.redis.keys('email_verification:*');
      let cleanedCount = 0;

      for (const key of keys) {
        const tokenDataStr = await this.redis.get(key);
        if (tokenDataStr) {
          const tokenData: EmailVerificationToken = JSON.parse(tokenDataStr);
          if (new Date() > new Date(tokenData.expiresAt)) {
            await this.redis.del(key);
            cleanedCount++;
          }
        }
      }

      if (cleanedCount > 0) {
        this.logger.debug(`Cleaned up ${cleanedCount} expired verification tokens`);
      }
    } catch (error) {
      this.logger.error('Error cleaning up expired verification tokens:', error.stack);
    }
  }
}