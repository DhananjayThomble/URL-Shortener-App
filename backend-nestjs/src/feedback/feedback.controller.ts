import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @UseGuards(JwtAuthGuard)
  @Post('submit')
  async submitFeedback(
    @Request() req,
    @Body('message') message: string,
    @Body('rating') rating: number,
  ): Promise<void> {
    return this.feedbackService.submitFeedback(req.user.id, message, rating);
  }

  @Get('reviews')
  async getReviews(): Promise<any> {
    return this.feedbackService.getReviews();
  }
}
