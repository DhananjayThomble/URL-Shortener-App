import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

// Schemas
import { ClickEvent, ClickEventSchema } from './schemas/click-event.schema';
import { AnalyticsAggregation, AnalyticsAggregationSchema } from './schemas/analytics-aggregation.schema';

// Services
import { ClickEventService } from './services/click-event.service';
import { DeviceLocationDetectionService } from './services/device-location-detection.service';
import { AnalyticsAggregationService } from './services/analytics-aggregation.service';

// Controllers
import { AnalyticsController } from './controllers/analytics.controller';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: ClickEvent.name, schema: ClickEventSchema },
      { name: AnalyticsAggregation.name, schema: AnalyticsAggregationSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [
    ClickEventService,
    DeviceLocationDetectionService,
    AnalyticsAggregationService,
  ],
  exports: [
    ClickEventService,
    DeviceLocationDetectionService,
    AnalyticsAggregationService,
  ],
})
export class AnalyticsModule {}