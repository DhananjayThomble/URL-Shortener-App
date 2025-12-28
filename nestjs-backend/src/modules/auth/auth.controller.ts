import { Controller, Post, Body, UseGuards, Request, Get, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Throttle } from '../../common/decorators/throttle.decorator';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyResetTokenDto } from './dto/verify-reset-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
import { EnhancedRateLimitGuard, RateLimit } from './guards/enhanced-rate-limit.guard';
import { SanitizationPipe } from './pipes/sanitization.pipe';

@ApiTags('auth')
@Controller('auth')
@UseGuards(EnhancedRateLimitGuard)
@UsePipes(SanitizationPipe)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Post('register')
  @RateLimit({ 
    configName: 'auth',
    keyGenerator: (req) => `register:${req.ip}`,
  })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ 
    status: 201, 
    description: 'User successfully registered',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 409, description: 'User already exists' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @RateLimit({ 
    configName: 'auth',
    keyGenerator: (req) => `login:${req.body?.email || req.ip}`,
  })
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ 
    status: 200, 
    description: 'User successfully logged in',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ 
    status: 200, 
    description: 'Token successfully refreshed',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto.refresh_token);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: 200, description: 'User successfully logged out' })
  async logout(@Request() req, @Body() body?: { refresh_token?: string }) {
    await this.authService.logout(req.user.id, body?.refresh_token);
    return { message: 'Successfully logged out' };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout from all devices' })
  @ApiResponse({ status: 200, description: 'Successfully logged out from all devices' })
  async logoutAll(@Request() req) {
    await this.authService.logoutAll(req.user.id);
    return { message: 'Successfully logged out from all devices' };
  }

  @Post('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  async getProfile(@Request() req) {
    return req.user;
  }

  @Post('forgot-password')
  @RateLimit({ 
    configName: 'password-reset',
    keyGenerator: (req) => `forgot:${req.body?.email || req.ip}`,
  })
  @ApiOperation({ summary: 'Request password reset' })
  @ApiResponse({ 
    status: 200, 
    description: 'Password reset email sent if email exists',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid email format' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  @RateLimit({ 
    configName: 'password-reset',
    keyGenerator: (req) => `reset:${req.body?.token || req.ip}`,
  })
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({ 
    status: 200, 
    description: 'Password reset successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 401, description: 'Invalid or expired reset token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
}
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ name: 'auth', ttl: 900000, limit: 5 })
  @ApiOperation({ summary: 'Change password for authenticated user' })
  @ApiResponse({ 
    status: 200, 
    description: 'Password changed successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async changePassword(@Request() req, @Body() changePasswordDto: ChangePasswordDto) {
    return this.authService.changePassword(
      req.user.id,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
  }

  @Post('blacklist-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Blacklist a specific token' })
  @ApiResponse({ status: 200, description: 'Token blacklisted successfully' })
  async blacklistToken(@Request() req, @Body() body: { token: string }) {
    await this.authService.blacklistToken(body.token);
    return { message: 'Token blacklisted successfully' };
  }

  @Post('active-tokens')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active tokens for current user' })
  @ApiResponse({ status: 200, description: 'Active tokens retrieved' })
  async getActiveTokens(@Request() req) {
    const tokens = await this.authService.getUserActiveTokens(req.user.id);
    return { tokens };
  }

  @Post('send-verification')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @RateLimit({ 
    configName: 'email-verification',
    keyGenerator: (req) => `verify:${req.user?.id || req.ip}`,
  })
  @ApiOperation({ summary: 'Send email verification' })
  @ApiResponse({ 
    status: 200, 
    description: 'Verification email sent',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request or rate limited' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async sendVerificationEmail(@Request() req) {
    return this.emailVerificationService.sendVerificationEmail(req.user.id, req.user.email);
  }

  @Post('verify-email')
  @Throttle({ name: 'auth', ttl: 900000, limit: 10 }) // 10 requests per 15 minutes
  @ApiOperation({ summary: 'Verify email address' })
  @ApiResponse({ 
    status: 200, 
    description: 'Email verified successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            isEmailVerified: { type: 'boolean' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 401, description: 'Invalid or expired verification token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.emailVerificationService.verifyEmail(verifyEmailDto.token);
  }

  @Post('resend-verification')
  @Throttle({ name: 'auth', ttl: 900000, limit: 3 }) // 3 requests per 15 minutes
  @ApiOperation({ summary: 'Resend email verification' })
  @ApiResponse({ 
    status: 200, 
    description: 'Verification email sent if email exists and is not verified',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid email format' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async resendVerificationEmail(@Body() resendVerificationDto: ResendVerificationDto) {
    return this.emailVerificationService.resendVerificationEmail(resendVerificationDto.email);
  }

  @Get('verification-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get email verification status' })
  @ApiResponse({ 
    status: 200, 
    description: 'Verification status retrieved',
    schema: {
      type: 'object',
      properties: {
        isVerified: { type: 'boolean' },
        email: { type: 'string' },
        canResend: { type: 'boolean' },
        nextResendAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  async getVerificationStatus(@Request() req) {
    return this.emailVerificationService.getVerificationStatus(req.user.id);
  }

  @Post('verify-reset-token')
  @Throttle({ name: 'auth', ttl: 900000, limit: 10 }) // 10 requests per 15 minutes
  @ApiOperation({ summary: 'Verify password reset token' })
  @ApiResponse({ 
    status: 200, 
    description: 'Token verification result',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        email: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async verifyResetToken(@Body() verifyResetTokenDto: VerifyResetTokenDto) {
    return this.passwordResetService.verifyResetToken(verifyResetTokenDto.token);
  }

  @Post('reset-status')
  @Throttle({ name: 'auth', ttl: 900000, limit: 10 }) // 10 requests per 15 minutes
  @ApiOperation({ summary: 'Get password reset status for email' })
  @ApiResponse({ 
    status: 200, 
    description: 'Reset status retrieved',
    schema: {
      type: 'object',
      properties: {
        canRequest: { type: 'boolean' },
        attemptsRemaining: { type: 'number' },
        nextRequestAt: { type: 'string', format: 'date-time', nullable: true },
        cooldownEndsAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid email format' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getResetStatus(@Body() body: { email: string }) {
    return this.passwordResetService.getResetStatus(body.email);
  }
}
