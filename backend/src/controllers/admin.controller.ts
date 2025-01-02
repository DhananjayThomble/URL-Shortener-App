import { Controller, Post, Body, Get, Delete, Param, UseGuards } from '@nestjs/common';
import { AdminService } from '../services/admin.service';
import { AuthGuard } from '@nestjs/passport';
import { IsAdminGuard } from '../guards/isAdmin.guard';
import { CreateAdminDto, LoginAdminDto, ForgotPasswordDto, ResetPasswordDto } from '../dtos/admin.dto';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('signup')
  async signup(@Body() createAdminDto: CreateAdminDto) {
    return this.adminService.signup(createAdminDto);
  }

  @Post('login')
  async login(@Body() loginAdminDto: LoginAdminDto) {
    return this.adminService.login(loginAdminDto);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.adminService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.adminService.resetPassword(resetPasswordDto);
  }

  @UseGuards(AuthGuard('jwt'), IsAdminGuard)
  @Get('reviews')
  async getReviews() {
    return this.adminService.getReviews();
  }

  @UseGuards(AuthGuard('jwt'), IsAdminGuard)
  @Delete('reviews/:id')
  async deleteReview(@Param('id') id: string) {
    return this.adminService.deleteReview(id);
  }

  @UseGuards(AuthGuard('jwt'), IsAdminGuard)
  @Delete('reviews')
  async deleteAllReviews() {
    return this.adminService.deleteAllReviews();
  }
}
