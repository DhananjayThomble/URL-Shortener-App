import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { LocalAuthGuard } from './local-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signup(@Body() signupDto: SignupDto): Promise<void> {
    return this.authService.signup(signupDto);
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Body() loginDto: LoginDto): Promise<{ accessToken: string }> {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-email')
  async changeEmail(@Request() req, @Body('newEmail') newEmail: string): Promise<void> {
    return this.authService.changeEmail(req.user.id, newEmail);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-name')
  async changeName(@Request() req, @Body('newName') newName: string): Promise<void> {
    return this.authService.changeName(req.user.id, newName);
  }

  @UseGuards(JwtAuthGuard)
  @Post('reset-password')
  async resetPassword(@Request() req, @Body('newPassword') newPassword: string): Promise<void> {
    return this.authService.resetPassword(req.user.id, newPassword);
  }
}
