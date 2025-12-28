import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClickEvent, ClickEventDocument } from '../schemas/click-event.schema';
import { AnalyticsAggregation, AnalyticsAggregationDocument } from '../schemas/analytics-aggregation.schema';
import { AnalyticsQueryDto, TopAnalyticsQueryDto, RealTimeAnalyticsQueryDto, AnalyticsPeriod } from '../dto/analytics-query.dto';

export interface AnalyticsTimeSeriesData {
  date: Date;
  totalClicks: number;
  uniqueClicks: number;
  deviceBreakdown: {
    desktop: number;
    mobile: number;
    tablet: number;
  };
}

export interface TopAnalyticsData {
  countries: Array<{ country: string; clicks: number }>;
  browsers: Array<{ browser: string; clicks: number }>;
  referrers: Array<{ referrer: string; clicks: number }>;
  utmSources: Array<{ source: string; clicks: number }>;
  utmCampaigns: Array<{ campaign: string; clicks: number }>;
}

export interface RealTimeAnalyticsData {
  totalClicks: number;
  uniqueClicks: number;
  clicksPerMinute: Array<{ minute: Date; clicks: number }>;
  topCountries: Array<{ country: string; clicks: number }>;
  topDevices: Array<{ device: string; clicks: number }>;
}

export interface AnalyticsSummary {
  totalClicks: number;
  uniqueClicks: number;
  totalLinks: number;
  clickThroughRate: number;
  averageClicksPerLink: number;
  topPerformingLink?: {
    linkId: string;
    clicks: number;
  };
}

@Injectable()
export class AnalyticsAggregationService {
  private readonly logger = new Logger(AnalyticsAggregationService.name);

  constructor(
    @InjectModel(ClickEvent.name)
    private readonly clickEventModel: Model<ClickEventDocument>,
    @InjectModel(AnalyticsAggregation.name)
    private readonly analyticsAggregationModel: Model<AnalyticsAggregationDocument>,
  ) {}

  /**
   * Get time series analytics data
   */
  async getTimeSeriesAnalytics(query: AnalyticsQueryDto): Promise<AnalyticsTimeSeriesData[]> {
    try {
      const matchStage: any = {
        date: {
          $gte: new Date(query.startDate),
          $lte: new Date(query.endDate),
        },
        period: query.period || AnalyticsPeriod.DAY,
      };

      if (query.linkId) {
        matchStage.linkId = query.linkId;
      }

      if (query.userId) {
        matchStage.userId = query.userId;
      }

      const aggregations = await this.analyticsAggregationModel
        .find(matchStage)
        .sort({ date: 1 })
        .limit(query.limit || 100)
        .skip(query.offset || 0)
        .lean()
        .exec();

      return aggregations.map(agg => ({
        date: agg.date,
        totalClicks: agg.totalClicks,
        uniqueClicks: agg.uniqueClicks,
        deviceBreakdown: agg.deviceBreakdown,
      }));
    } catch (error) {
      this.logger.error(`Failed to get time series analytics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get top analytics data (countries, browsers, referrers, etc.)
   */
  async getTopAnalytics(query: TopAnalyticsQueryDto): Promise<TopAnalyticsData> {
    try {
      const matchStage: any = {
        date: {
          $gte: new Date(query.startDate),
          $lte: new Date(query.endDate),
        },
      };

      if (query.linkId) {
        matchStage.linkId = query.linkId;
      }

      if (query.userId) {
        matchStage.userId = query.userId;
      }

      const aggregations = await this.analyticsAggregationModel
        .find(matchStage)
        .lean()
        .exec();

      // Aggregate data across all periods
      const countries = this.aggregateMapData(aggregations, 'countryBreakdown', query.limit || 10);
      const browsers = this.aggregateMapData(aggregations, 'browserBreakdown', query.limit || 10);
      const referrers = this.aggregateMapData(aggregations, 'referrerBreakdown', query.limit || 10);
      const utmSources = this.aggregateMapData(aggregations, 'utmSourceBreakdown', query.limit || 10);
      const utmCampaigns = this.aggregateMapData(aggregations, 'utmCampaignBreakdown', query.limit || 10);

      return {
        countries: countries.map(item => ({ country: item.key, clicks: item.value })),
        browsers: browsers.map(item => ({ browser: item.key, clicks: item.value })),
        referrers: referrers.map(item => ({ referrer: item.key, clicks: item.value })),
        utmSources: utmSources.map(item => ({ source: item.key, clicks: item.value })),
        utmCampaigns: utmCampaigns.map(item => ({ campaign: item.key, clicks: item.value })),
      };
    } catch (error) {
      this.logger.error(`Failed to get top analytics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get real-time analytics data
   */
  async getRealTimeAnalytics(query: RealTimeAnalyticsQueryDto): Promise<RealTimeAnalyticsData> {
    try {
      const minutesBack = query.minutes || 60;
      const startTime = new Date(Date.now() - minutesBack * 60 * 1000);

      const matchStage: any = {
        clickedAt: { $gte: startTime },
      };

      if (query.linkId) {
        matchStage.linkId = query.linkId;
      }

      if (query.userId) {
        matchStage.userId = query.userId;
      }

      // Get raw click events for real-time data
      const clickEvents = await this.clickEventModel
        .find(matchStage)
        .lean()
        .exec();

      // Calculate metrics
      const totalClicks = clickEvents.length;
      const uniqueClicks = new Set(clickEvents.map(event => event.ipHash)).size;

      // Group clicks by minute
      const clicksPerMinute = this.groupClicksByMinute(clickEvents, minutesBack);

      // Get top countries and devices
      const topCountries = this.getTopFromArray(
        clickEvents,
        'country',
        5
      ).map(item => ({ country: item.key, clicks: item.count }));

      const topDevices = this.getTopFromArray(
        clickEvents,
        'device',
        3
      ).map(item => ({ device: item.key, clicks: item.count }));

      return {
        totalClicks,
        uniqueClicks,
        clicksPerMinute,
        topCountries,
        topDevices,
      };
    } catch (error) {
      this.logger.error(`Failed to get real-time analytics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get analytics summary for dashboard
   */
  async getAnalyticsSummary(
    userId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<AnalyticsSummary> {
    try {
      const matchStage: any = {};

      if (userId) {
        matchStage.userId = userId;
      }

      if (startDate && endDate) {
        matchStage.date = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }

      const summaryPipeline: any[] = [
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalClicks: { $sum: '$totalClicks' },
            uniqueClicks: { $sum: '$uniqueClicks' },
            totalLinks: { $addToSet: '$linkId' },
          },
        },
        {
          $project: {
            _id: 0,
            totalClicks: 1,
            uniqueClicks: 1,
            totalLinks: { $size: '$totalLinks' },
            averageClicksPerLink: {
              $cond: {
                if: { $gt: [{ $size: '$totalLinks' }, 0] },
                then: { $divide: ['$totalClicks', { $size: '$totalLinks' }] },
                else: 0,
              },
            },
          },
        },
      ];

      const summaryResult = await this.analyticsAggregationModel
        .aggregate(summaryPipeline)
        .exec();

      const summary = summaryResult[0] || {
        totalClicks: 0,
        uniqueClicks: 0,
        totalLinks: 0,
        averageClicksPerLink: 0,
      };

      // Get top performing link
      const topLinkPipeline: any[] = [
        { $match: matchStage },
        {
          $group: {
            _id: '$linkId',
            totalClicks: { $sum: '$totalClicks' },
          },
        },
        { $sort: { totalClicks: -1 } },
        { $limit: 1 },
      ];

      const topLinkResult = await this.analyticsAggregationModel
        .aggregate(topLinkPipeline)
        .exec();

      const topPerformingLink = topLinkResult[0]
        ? {
            linkId: topLinkResult[0]._id,
            clicks: topLinkResult[0].totalClicks,
          }
        : undefined;

      return {
        ...summary,
        clickThroughRate: summary.totalLinks > 0 ? (summary.totalClicks / summary.totalLinks) * 100 : 0,
        topPerformingLink,
      };
    } catch (error) {
      this.logger.error(`Failed to get analytics summary: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Aggregate click events into time-based aggregations
   * This method is called by a cron job to pre-aggregate data
   */
  @Cron(CronExpression.EVERY_HOUR)
  async aggregateHourlyData(): Promise<void> {
    try {
      const now = new Date();
      const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
      const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

      await this.aggregateDataForPeriod(hourStart, hourEnd, AnalyticsPeriod.HOUR);
      this.logger.log(`Hourly aggregation completed for ${hourStart.toISOString()}`);
    } catch (error) {
      this.logger.error(`Failed to aggregate hourly data: ${error.message}`, error.stack);
    }
  }

  /**
   * Aggregate click events into daily aggregations
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async aggregateDailyData(): Promise<void> {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      await this.aggregateDataForPeriod(dayStart, dayEnd, AnalyticsPeriod.DAY);
      this.logger.log(`Daily aggregation completed for ${dayStart.toISOString()}`);
    } catch (error) {
      this.logger.error(`Failed to aggregate daily data: ${error.message}`, error.stack);
    }
  }

  /**
   * Aggregate data for a specific time period
   */
  private async aggregateDataForPeriod(
    startDate: Date,
    endDate: Date,
    period: AnalyticsPeriod,
  ): Promise<void> {
    const pipeline: any[] = [
      {
        $match: {
          clickedAt: {
            $gte: startDate,
            $lt: endDate,
          },
        },
      },
      {
        $group: {
          _id: {
            linkId: '$linkId',
            userId: '$userId',
          },
          totalClicks: { $sum: 1 },
          uniqueClicks: { $addToSet: '$ipHash' },
          deviceBreakdown: {
            $push: '$device',
          },
          countries: { $push: '$country' },
          browsers: { $push: '$browser' },
          referrers: { $push: '$referrer' },
          utmSources: { $push: '$utmSource' },
          utmMediums: { $push: '$utmMedium' },
          utmCampaigns: { $push: '$utmCampaign' },
          botClicks: {
            $sum: { $cond: [{ $eq: ['$isBot', true] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          linkId: '$_id.linkId',
          userId: '$_id.userId',
          totalClicks: 1,
          uniqueClicks: { $size: '$uniqueClicks' },
          deviceBreakdown: {
            desktop: {
              $size: {
                $filter: {
                  input: '$deviceBreakdown',
                  cond: { $eq: ['$$this', 'desktop'] },
                },
              },
            },
            mobile: {
              $size: {
                $filter: {
                  input: '$deviceBreakdown',
                  cond: { $eq: ['$$this', 'mobile'] },
                },
              },
            },
            tablet: {
              $size: {
                $filter: {
                  input: '$deviceBreakdown',
                  cond: { $eq: ['$$this', 'tablet'] },
                },
              },
            },
          },
          countries: 1,
          browsers: 1,
          referrers: 1,
          utmSources: 1,
          utmMediums: 1,
          utmCampaigns: 1,
          botClicks: 1,
        },
      },
    ];

    const aggregatedData = await this.clickEventModel.aggregate(pipeline).exec();

    // Save aggregated data
    for (const data of aggregatedData) {
      const aggregation = {
        linkId: data.linkId,
        userId: data.userId,
        date: startDate,
        period,
        totalClicks: data.totalClicks,
        uniqueClicks: data.uniqueClicks,
        deviceBreakdown: data.deviceBreakdown,
        countryBreakdown: this.arrayToMap(data.countries),
        browserBreakdown: this.arrayToMap(data.browsers),
        referrerBreakdown: this.arrayToMap(data.referrers),
        utmSourceBreakdown: this.arrayToMap(data.utmSources),
        utmMediumBreakdown: this.arrayToMap(data.utmMediums),
        utmCampaignBreakdown: this.arrayToMap(data.utmCampaigns),
        botClicks: data.botClicks,
      };

      await this.analyticsAggregationModel.findOneAndUpdate(
        {
          linkId: data.linkId,
          period,
          date: startDate,
        },
        aggregation,
        { upsert: true, new: true }
      );
    }
  }

  /**
   * Helper method to convert array to frequency map
   */
  private arrayToMap(array: string[]): Map<string, number> {
    const map = new Map<string, number>();
    array.forEach(item => {
      if (item && item !== 'Unknown') {
        map.set(item, (map.get(item) || 0) + 1);
      }
    });
    return map;
  }

  /**
   * Helper method to aggregate map data across multiple aggregations
   */
  private aggregateMapData(
    aggregations: any[],
    field: string,
    limit: number,
  ): Array<{ key: string; value: number }> {
    const combined = new Map<string, number>();

    aggregations.forEach(agg => {
      const mapData = agg[field];
      if (mapData instanceof Map) {
        mapData.forEach((value, key) => {
          combined.set(key, (combined.get(key) || 0) + value);
        });
      } else if (typeof mapData === 'object') {
        Object.entries(mapData).forEach(([key, value]) => {
          combined.set(key, (combined.get(key) || 0) + (value as number));
        });
      }
    });

    return Array.from(combined.entries())
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }

  /**
   * Helper method to group clicks by minute for real-time analytics
   */
  private groupClicksByMinute(
    clickEvents: any[],
    minutesBack: number,
  ): Array<{ minute: Date; clicks: number }> {
    const now = new Date();
    const minutes: Array<{ minute: Date; clicks: number }> = [];

    for (let i = minutesBack - 1; i >= 0; i--) {
      const minute = new Date(now.getTime() - i * 60 * 1000);
      minute.setSeconds(0, 0);
      
      const clicksInMinute = clickEvents.filter(event => {
        const eventMinute = new Date(event.clickedAt);
        eventMinute.setSeconds(0, 0);
        return eventMinute.getTime() === minute.getTime();
      }).length;

      minutes.push({ minute, clicks: clicksInMinute });
    }

    return minutes;
  }

  /**
   * Helper method to get top items from array
   */
  private getTopFromArray(
    array: any[],
    field: string,
    limit: number,
  ): Array<{ key: string; count: number }> {
    const counts = new Map<string, number>();

    array.forEach(item => {
      const value = item[field];
      if (value && value !== 'Unknown') {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    });

    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
}