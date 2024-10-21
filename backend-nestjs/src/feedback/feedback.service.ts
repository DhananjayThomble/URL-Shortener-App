import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback } from './feedback.entity';
import { User } from '../auth/user.entity';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(Feedback)
    private readonly feedbackRepository: Repository<Feedback>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async submitFeedback(userId: number, message: string, rating: number): Promise<void> {
    const user = await this.userRepository.findOne(userId);

    if (!user) {
      throw new Error('User not found');
    }

    const feedback = this.feedbackRepository.create({
      name: user.name,
      email: user.email,
      message,
      rating,
    });

    await this.feedbackRepository.save(feedback);
  }

  async getReviews(): Promise<Feedback[]> {
    return this.feedbackRepository.find();
  }
}
