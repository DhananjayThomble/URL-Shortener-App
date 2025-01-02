import { Controller, Post, Body, Get, Patch, Query, UseGuards, Req } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { LoginDto, SignupDto, ForgotPasswordDto, ResetPasswordDto, VerifyEmailDto, ChangeEmailDto, ChangeNameDto } from '../dtos/auth.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('signup')
  async signup(@Body() signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Get('verify-email')
  async verifyEmail(@Query() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('current-user')
  async getCurrentUser(@Req() req: Request) {
    return this.authService.getCurrentUser(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('change-email')
  async changeEmail(@Body() changeEmailDto: ChangeEmailDto) {
    return this.authService.changeEmail(changeEmailDto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('change-name')
  async changeName(@Body() changeNameDto: ChangeNameDto) {
    return this.authService.changeName(changeNameDto);
  }
}
