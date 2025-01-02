import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Feedback } from '../models/feedback.model';
import { User } from '../models/user.model';
import { FeedbackDto } from '../dtos/feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectModel(Feedback.name) private feedbackModel: Model<Feedback>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  async submitFeedback(userId: string, feedbackDto: FeedbackDto): Promise<Feedback> {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    const { name, email } = user;
    const { message, rating } = feedbackDto;

    const feedback = new this.feedbackModel({ name, email, message, rating });
    return feedback.save();
  }
}
