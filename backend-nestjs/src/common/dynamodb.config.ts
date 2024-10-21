import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamoDB } from 'aws-sdk';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'DYNAMODB',
      useFactory: async (configService: ConfigService) => {
        return new DynamoDB({
          region: configService.get<string>('AWS_REGION'),
          accessKeyId: configService.get<string>('AWS_ACCESS_KEY_ID'),
          secretAccessKey: configService.get<string>('AWS_SECRET_ACCESS_KEY'),
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: ['DYNAMODB'],
})
export class DynamoDBConfigModule {}
