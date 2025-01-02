import { Controller, Post, Body, Req, Res, HttpStatus } from '@nestjs/common';
import { FeedbackService } from '../services/feedback.service';
import { FeedbackDto } from '../dtos/feedback.dto';
import { Request, Response } from 'express';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  async submitFeedback(
    @Body() feedbackDto: FeedbackDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const feedback = await this.feedbackService.submitFeedback(
        req.user._id,
        feedbackDto,
      );
      return res.status(HttpStatus.OK).json({
        message: 'Feedback submitted successfully.',
        feedback,
      });
    } catch (error) {
      console.error(error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Feedback submission failed.',
        error: error.message,
      });
    }
  }
}
