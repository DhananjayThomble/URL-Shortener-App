import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from '@nestjs/common';
import { AdminModule } from './controllers/admin.controller';
import { AuthModule } from './controllers/auth.controller';
import { FeedbackModule } from './controllers/feedback.controller';
import { UrlModule } from './controllers/url.controller';
import { AuthMiddleware } from './middlewares/auth.middleware';
import { IsAdminMiddleware } from './middlewares/isAdmin.middleware';
import { ValidatorErrorHandlerMiddleware } from './middlewares/validatorErrorHandler.middleware';
import { AdminService } from './services/admin.service';
import { AuthService } from './services/auth.service';
import { FeedbackService } from './services/feedback.service';
import { UrlService } from './services/url.service';
import { DnsUtil } from './utils/dns.util';
import { MailUtil } from './utils/mail.util';
import { AuthValidator } from './validators/auth.validator';
import { FeedbackValidator } from './validators/feedback.validator';
import { UrlValidator } from './validators/url.validator';
import { DatabaseConfig } from './config/database.config';
import { EmailConfig } from './config/email.config';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useClass: DatabaseConfig,
    }),
    ScheduleModule.forRoot(),
    CacheModule.register(),
    AdminModule,
    AuthModule,
    FeedbackModule,
    UrlModule,
  ],
  controllers: [],
  providers: [
    AuthMiddleware,
    IsAdminMiddleware,
    ValidatorErrorHandlerMiddleware,
    AdminService,
    AuthService,
    FeedbackService,
    UrlService,
    DnsUtil,
    MailUtil,
    AuthValidator,
    FeedbackValidator,
    UrlValidator,
    EmailConfig,
  ],
})
export class AppModule {}
