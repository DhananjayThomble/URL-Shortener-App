import { Injectable, UnauthorizedException, Logger, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import { RefreshTokenService } from '../users/entities/refresh-token.service';
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CacheService } from '../../common/services/cache.service';
import { EmailService } from '../../common/services/email.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private refreshTokenService: RefreshTokenService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private cacheService: CacheService,
    private emailService: EmailService,
  ) { }

  async validateUser(email: string, password: string): Promise<User | null> {
    try {
      this.logger.debug(`Validating user: ${email}`);

      const user = await this.usersService.findByEmail(email);
      if (!user) {
        this.logger.debug(`User not found: ${email}`);
        return null;
      }

      this.logger.debug(`User found: ${user.id}, checking password`);

      const isPasswordValid = await this.comparePassword(password, user.passwordHash);
      if (!isPasswordValid) {
        this.logger.debug(`Invalid password for user: ${email}`);
        return null;
      }

      this.logger.debug(`Password valid for user: ${email}`);
      return user;
    } catch (error) {
      this.logger.error(`Error validating user ${email}:`, error.stack);
      return null;
    }
  }

  async login(loginDto: LoginDto) {
    try {
      this.logger.debug(`Login attempt for email: ${loginDto.email}`);

      // Validate input
      if (!loginDto.email || !loginDto.password) {
        this.logger.warn(`Login failed: Missing email or password for ${loginDto.email}`);
        throw new UnauthorizedException('Email and password are required');
      }

      const user = await this.validateUser(loginDto.email, loginDto.password);
      if (!user) {
        this.logger.warn(`Login failed: Invalid credentials for ${loginDto.email}`);
        throw new UnauthorizedException('Invalid email or password');
      }

      this.logger.debug(`User validated successfully: ${user.id}`);

      const payload = {
        sub: user.id,
        email: user.email,
        role: user.role
      };

      const accessToken = this.jwtService.sign(payload);
      const refreshToken = this.jwtService.sign(payload, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      });

      this.logger.debug(`Tokens generated for user: ${user.id}`);

      // Store refresh token in database
      await this.refreshTokenService.createRefreshToken(user.id, refreshToken);

      // Cache user session data for quick access
      const sessionData = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        lastLogin: new Date(),
      };

      await this.cacheService.cacheUserSession(user.id, sessionData, 900); // 15 minutes TTL

      this.logger.log(`Login successful for user: ${user.email}`);

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: sessionData,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error(`Login error for ${loginDto.email}:`, error.stack);
      throw new InternalServerErrorException('Login failed. Please try again.');
    }
  }

  async register(registerDto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    const hashedPassword = await this.hashPassword(registerDto.password);
    const user = await this.usersService.create({
      ...registerDto,
      passwordHash: hashedPassword,
    });

    return this.login({ email: user.email, password: registerDto.password });
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Validate refresh token in database
      const isValidToken = await this.refreshTokenService.validateRefreshToken(
        user.id,
        refreshToken,
      );

      if (!isValidToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const newPayload = {
        sub: user.id,
        email: user.email,
        role: user.role
      };

      return {
        access_token: this.jwtService.sign(newPayload),
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.refreshTokenService.revokeRefreshToken(userId, refreshToken);

    // Clear user session from cache
    await this.cacheService.invalidateUserSession(userId);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokenService.revokeAllUserTokens(userId);

    // Clear all user-related cache data
    await this.cacheService.invalidateUserCache(userId);
  }

  async hashPassword(password: string): Promise<string> {
    const saltRounds = parseInt(this.configService.get('BCRYPT_SALT_ROUNDS', '12'), 10);
    return bcrypt.hash(password, saltRounds);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async validateJWTPayload(payload: any): Promise<User> {
    // Try to get user from cache first
    const cachedUser = await this.cacheService.getCachedUserSession(payload.sub);
    if (cachedUser) {
      // Return a User-like object from cached data
      return {
        id: cachedUser.id,
        email: cachedUser.email,
        name: cachedUser.name,
        role: cachedUser.role,
      } as User;
    }

    // Fallback to database
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    // Cache the user data for future requests
    const sessionData = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      lastAccess: new Date(),
    };

    await this.cacheService.cacheUserSession(user.id, sessionData, 900); // 15 minutes TTL

    return user;
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
    try {
      this.logger.debug(`Password reset requested for: ${forgotPasswordDto.email}`);

      const user = await this.usersService.findByEmail(forgotPasswordDto.email);
      if (!user) {
        // Don't reveal if email exists or not for security
        this.logger.warn(`Password reset requested for non-existent email: ${forgotPasswordDto.email}`);
        return { message: 'If the email exists, a password reset link has been sent.' };
      }

      // Generate secure reset token
      const resetToken = this.generateResetToken();
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Save reset token to user
      await this.usersService.updatePasswordResetToken(user.id, resetToken, resetExpires);

      // Send reset email
      await this.emailService.sendPasswordResetEmail(user.email, resetToken);

      this.logger.log(`Password reset email sent to: ${user.email}`);
      return { message: 'If the email exists, a password reset link has been sent.' };
    } catch (error) {
      this.logger.error(`Error in forgotPassword for ${forgotPasswordDto.email}:`, error.stack);
      throw new InternalServerErrorException('Failed to process password reset request. Please try again.');
    }
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    try {
      this.logger.debug(`Password reset attempt with token: ${resetPasswordDto.token.substring(0, 8)}...`);

      const user = await this.usersService.findByPasswordResetToken(resetPasswordDto.token);
      if (!user) {
        this.logger.warn(`Invalid reset token used: ${resetPasswordDto.token.substring(0, 8)}...`);
        throw new UnauthorizedException('Invalid or expired reset token');
      }

      // Check if token is expired
      if (!user.passwordResetExpires || user.passwordResetExpires < new Date()) {
        this.logger.warn(`Expired reset token used for user: ${user.email}`);
        throw new UnauthorizedException('Invalid or expired reset token');
      }

      // Hash new password
      const hashedPassword = await this.hashPassword(resetPasswordDto.newPassword);

      // Update password and clear reset token
      await this.usersService.updatePassword(user.id, hashedPassword);
      await this.usersService.clearPasswordResetToken(user.id);

      // Invalidate all refresh tokens for security
      await this.refreshTokenService.revokeAllUserTokens(user.id);

      // Clear user session cache
      await this.cacheService.invalidateUserCache(user.id);

      this.logger.log(`Password reset successful for user: ${user.email}`);
      return { message: 'Password has been reset successfully. Please log in with your new password.' };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error(`Error in resetPassword:`, error.stack);
      throw new InternalServerErrorException('Failed to reset password. Please try again.');
    }
  }

  private generateResetToken(): string {
    // Generate a secure random token
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    try {
      this.logger.debug(`Password change attempt for user: ${userId}`);

      // Get user and verify current password
      const user = await this.usersService.findById(userId);
      if (!user) {
        this.logger.warn(`User not found for password change: ${userId}`);
        throw new UnauthorizedException('User not found');
      }

      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isPasswordValid) {
        this.logger.warn(`Invalid current password for user: ${user.email}`);
        throw new UnauthorizedException('Current password is incorrect');
      }

      // Check if new password is different from current
      const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
      if (isSamePassword) {
        throw new UnauthorizedException('New password must be different from current password');
      }

      // Hash new password
      const hashedPassword = await this.hashPassword(newPassword);

      // Update password
      await this.usersService.updatePassword(user.id, hashedPassword);

      // Invalidate all refresh tokens for security
      await this.refreshTokenService.revokeAllUserTokens(user.id);

      // Clear user session cache
      await this.cacheService.invalidateUserCache(user.id);

      this.logger.log(`Password changed successfully for user: ${user.email}`);
      return { message: 'Password has been changed successfully. Please log in with your new password.' };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error(`Error in changePassword:`, error.stack);
      throw new InternalServerErrorException('Failed to change password. Please try again.');
    }
  }
}