import { Module } from "@nestjs/common";
import type { Database } from "@snapurl/database";
import { READ_DB } from "../database/database.module.js";
import { AnalyticsController } from "./analytics.controller.js";
import { ANALYTICS_READER, PostgresAnalyticsReader } from "./analytics.reader.js";
import { AnalyticsService } from "./analytics.service.js";

@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    // The analytics read path is swappable behind AnalyticsReader; bind the
    // Postgres adapter off the read replica, mirroring the token+useFactory
    // pattern in database.module.ts. A columnar adapter would bind here instead.
    { provide: ANALYTICS_READER, inject: [READ_DB], useFactory: (readDb: Database) => new PostgresAnalyticsReader(readDb) },
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
