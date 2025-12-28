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
import { EnhancedJwtService } from './services/enhanced-jwt.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';

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
    private enhancedJwtService: EnhancedJwtService,
    private emailVerificationService: EmailVerificationService,
    private passwordResetService: PasswordResetService,
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

      // Generate token pair using enhanced JWT service
      const tokenPair = await this.enhancedJwtService.generateTokenPair({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      this.logger.debug(`Tokens generated for user: ${user.id}`);

      // Store refresh token in database (for additional security layer)
      await this.refreshTokenService.createRefreshToken(user.id, tokenPair.refreshToken);

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
        access_token: tokenPair.accessToken,
        refresh_token: tokenPair.refreshToken,
        expires_at: tokenPair.accessTokenExpires,
        refresh_expires_at: tokenPair.refreshTokenExpires,
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
    try {
      const existingUser = await this.usersService.findByEmail(registerDto.email);
      if (existingUser) {
        throw new UnauthorizedException('User already exists');
      }

      const hashedPassword = await this.hashPassword(registerDto.password);
      const user = await this.usersService.create({
        ...registerDto,
        passwordHash: hashedPassword,
      });

      // Send verification email
      try {
        await this.emailVerificationService.sendVerificationEmail(user.id, user.email);
        this.logger.log(`Verification email sent to new user: ${user.email}`);
      } catch (emailError) {
        this.logger.warn(`Failed to send verification email to ${user.email}:`, emailError.message);
        // Don't fail registration if email sending fails
      }

      // Generate tokens for immediate login
      const tokenPair = await this.enhancedJwtService.generateTokenPair({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      // Store refresh token in database
      await this.refreshTokenService.createRefreshToken(user.id, tokenPair.refreshToken);

      // Cache user session data
      const sessionData = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        lastLogin: new Date(),
      };

      await this.cacheService.cacheUserSession(user.id, sessionData, 900); // 15 minutes TTL

      this.logger.log(`User registered successfully: ${user.email}`);

      return {
        access_token: tokenPair.accessToken,
        refresh_token: tokenPair.refreshToken,
        expires_at: tokenPair.accessTokenExpires,
        refresh_expires_at: tokenPair.refreshTokenExpires,
        user: sessionData,
        message: 'Registration successful. Please check your email to verify your account.',
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error(`Registration error for ${registerDto.email}:`, error.stack);
      throw new InternalServerErrorException('Registration failed. Please try again.');
    }
  }

  async refreshToken(refreshToken: string) {
    try {
      // Use enhanced JWT service to refresh token
      const result = await this.enhancedJwtService.refreshAccessToken(refreshToken);

      // Validate refresh token in database as additional security layer
      const payload = await this.enhancedJwtService.verifyToken(refreshToken, 'refresh');
      const isValidToken = await this.refreshTokenService.validateRefreshToken(
        payload.sub,
        refreshToken,
      );

      if (!isValidToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return {
        access_token: result.accessToken,
        expires_at: result.accessTokenExpires,
      };
    } catch (error) {
      this.logger.warn(`Refresh token failed: ${error.message}`);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    // Blacklist all user tokens using enhanced JWT service
    await this.enhancedJwtService.blacklistAllUserTokens(userId);

    // Also revoke refresh tokens in database
    if (refreshToken) {
      await this.refreshTokenService.revokeRefreshToken(userId, refreshToken);
    } else {
      await this.refreshTokenService.revokeAllUserTokens(userId);
    }

    // Clear user session from cache
    await this.cacheService.invalidateUserSession(userId);

    this.logger.log(`User logged out: ${userId}`);
  }

  async logoutAll(userId: string): Promise<void> {
    // Blacklist all user tokens
    await this.enhancedJwtService.blacklistAllUserTokens(userId);
    
    // Revoke all refresh tokens in database
    await this.refreshTokenService.revokeAllUserTokens(userId);

    // Clear all user-related cache data
    await this.cacheService.invalidateUserCache(userId);

    this.logger.log(`All sessions logged out for user: ${userId}`);
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
    return this.passwordResetService.requestPasswordReset(forgotPasswordDto.email);
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    return this.passwordResetService.resetPassword(resetPasswordDto.token, resetPasswordDto.newPassword);
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

      // Blacklist all user tokens and invalidate refresh tokens for security
      await this.enhancedJwtService.blacklistAllUserTokens(user.id);
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

  /**
   * Blacklist a specific token
   */
  async blacklistToken(token: string): Promise<void> {
    await this.enhancedJwtService.blacklistToken(token);
    this.logger.debug('Token blacklisted successfully');
  }

  /**
   * Get active tokens for a user
   */
  async getUserActiveTokens(userId: string) {
    return this.enhancedJwtService.getUserActiveTokens(userId);
  }

  /**
   * Verify password reset token
   */
  async verifyResetToken(token: string) {
    return this.passwordResetService.verifyResetToken(token);
  }

  /**
   * Get password reset status for an email
   */
  async getPasswordResetStatus(email: string) {
    return this.passwordResetService.getResetStatus(email);
  }
}