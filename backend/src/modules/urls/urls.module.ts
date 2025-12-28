import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { UrlsService } from './urls.service';
import { UrlsController, RedirectController } from './urls.controller';
import { Url, UrlSchema } from './schemas/url.schema';
import { ClickAnalytics, ClickAnalyticsSchema } from './schemas/click-analytics.schema';
import { LinkInBio, LinkInBioSchema } from './schemas/link-in-bio.schema';
import { UrlStats, UrlStatsSchema } from './schemas/url-stats.schema';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Url.name, schema: UrlSchema },
      { name: ClickAnalytics.name, schema: ClickAnalyticsSchema },
      { name: LinkInBio.name, schema: LinkInBioSchema },
      { name: UrlStats.name, schema: UrlStatsSchema },
    ]),
    UsersModule,
  ],
  controllers: [UrlsController, RedirectController],
  providers: [UrlsService],
  exports: [UrlsService],
})
export class UrlsModule {}