import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { UrlModule } from './url/url.module';
import { FeedbackModule } from './feedback/feedback.module';
import { DynamoDBConfigModule } from './common/dynamodb.config';

@Module({
  imports: [AuthModule, UrlModule, FeedbackModule, DynamoDBConfigModule],
})
export class AppModule {}
