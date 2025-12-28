import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { EnhancedJwtAuthGuard } from '../../auth/guards/enhanced-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity';
import { ClickEventService } from '../services/click-event.service';
import { DeviceLocationDetectionService } from '../services/device-location-detection.service';
import { AnalyticsAggregationService } from '../services/analytics-aggregation.service';
import { CreateClickEventDto } from '../dto/create-click-event.dto';
import {
  AnalyticsQueryDto,
  TopAnalyticsQueryDto,
  RealTimeAnalyticsQueryDto,
} from '../dto/analytics-query.dto';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly clickEventService: ClickEventService,
    private readonly deviceLocationDetectionService: DeviceLocationDetectionService,
    private readonly analyticsAggregationService: AnalyticsAggregationService,
  ) {}

  @Post('click-events')
  @ApiOperation({
    summary: 'Record a click event',
    description: 'Records a click event for analytics tracking',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Click event recorded successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid click event data',
  })
  async recordClickEvent(@Body() createClickEventDto: CreateClickEventDto) {
    try {
      const clickEvent = await this.clickEventService.createClickEvent(createClickEventDto);
      
      this.logger.log(`Click event recorded for link ${createClickEventDto.linkId}`);
      
      return {
        success: true,
        message: 'Click event recorded successfully',
        data: {
          linkId: clickEvent.linkId,
          clickedAt: clickEvent.clickedAt,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to record click event: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to record click event');
    }
  }

  @Post('track-click')
  @ApiOperation({
    summary: 'Track a click with automatic device and location detection',
    description: 'Records a click event with automatic device and location detection',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Click tracked successfully',
  })
  async trackClick(
    @Body()
    body: {
      linkId: string;
      userId: string;
      userAgent: string;
      ipAddress: string;
      referrer?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      utmTerm?: string;
      utmContent?: string;
    },
  ) {
    try {
      // Detect device and location information
      const detectionResult = await this.deviceLocationDetectionService.detectDeviceAndLocation(
        body.userAgent,
        body.ipAddress,
      );

      // Create click event with detected information
      const clickEventDto: CreateClickEventDto = {
        linkId: body.linkId,
        userId: body.userId,
        clickedAt: new Date(),
        ipHash: detectionResult.ipHash,
        userAgent: body.userAgent,
        browser: detectionResult.device.browser,
        device: detectionResult.device.device,
        os: detectionResult.device.os,
        country: detectionResult.location.country,
        city: detectionResult.location.city,
        referrer: body.referrer,
        utmSource: body.utmSource,
        utmMedium: body.utmMedium,
        utmCampaign: body.utmCampaign,
        utmTerm: body.utmTerm,
        utmContent: body.utmContent,
        isBot: detectionResult.device.isBot,
        sessionId: detectionResult.sessionId,
      };

      const clickEvent = await this.clickEventService.createClickEvent(clickEventDto);

      return {
        success: true,
        message: 'Click tracked successfully',
        data: {
          linkId: clickEvent.linkId,
          clickedAt: clickEvent.clickedAt,
          device: detectionResult.device.device,
          country: detectionResult.location.country,
          isBot: detectionResult.device.isBot,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to track click: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to track click');
    }
  }

  @Get('time-series')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get time series analytics data',
    description: 'Returns aggregated analytics data over time periods',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Time series analytics data retrieved successfully',
  })
  async getTimeSeriesAnalytics(
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: User,
  ) {
    try {
      // If no userId provided in query, use current user's ID
      if (!query.userId) {
        query.userId = user.id;
      }

      const data = await this.analyticsAggregationService.getTimeSeriesAnalytics(query);

      return {
        success: true,
        data,
        meta: {
          period: query.period,
          startDate: query.startDate,
          endDate: query.endDate,
          count: data.length,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get time series analytics: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve analytics data');
    }
  }

  @Get('top-stats')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get top analytics statistics',
    description: 'Returns top countries, browsers, referrers, and UTM data',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Top analytics statistics retrieved successfully',
  })
  async getTopAnalytics(
    @Query() query: TopAnalyticsQueryDto,
    @CurrentUser() user: User,
  ) {
    try {
      // If no userId provided in query, use current user's ID
      if (!query.userId) {
        query.userId = user.id;
      }

      const data = await this.analyticsAggregationService.getTopAnalytics(query);

      return {
        success: true,
        data,
        meta: {
          startDate: query.startDate,
          endDate: query.endDate,
          limit: query.limit,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get top analytics: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve top analytics');
    }
  }

  @Get('real-time')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get real-time analytics data',
    description: 'Returns real-time analytics data for the specified time window',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Real-time analytics data retrieved successfully',
  })
  async getRealTimeAnalytics(
    @Query() query: RealTimeAnalyticsQueryDto,
    @CurrentUser() user: User,
  ) {
    try {
      // If no userId provided in query, use current user's ID
      if (!query.userId) {
        query.userId = user.id;
      }

      const data = await this.analyticsAggregationService.getRealTimeAnalytics(query);

      return {
        success: true,
        data,
        meta: {
          minutes: query.minutes,
          generatedAt: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get real-time analytics: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve real-time analytics');
    }
  }

  @Get('summary')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get analytics summary',
    description: 'Returns a summary of analytics data for dashboard display',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Analytics summary retrieved successfully',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date for summary period',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date for summary period',
  })
  async getAnalyticsSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @CurrentUser() user?: User,
  ) {
    try {
      const userId = user?.id;
      const data = await this.analyticsAggregationService.getAnalyticsSummary(
        userId,
        startDate,
        endDate,
      );

      return {
        success: true,
        data,
        meta: {
          userId,
          startDate,
          endDate,
          generatedAt: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get analytics summary: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve analytics summary');
    }
  }

  @Get('link/:linkId/stats')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get analytics for a specific link',
    description: 'Returns detailed analytics data for a specific link',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Link analytics retrieved successfully',
  })
  async getLinkAnalytics(
    @Query('linkId') linkId: string,
    @CurrentUser() user: User,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    try {
      const clickEvents = await this.clickEventService.getClickEventsByLink(
        linkId,
        limit || 100,
        offset || 0,
      );

      const totalClicks = await this.clickEventService.getClickCountByLink(linkId);
      const uniqueClicks = await this.clickEventService.getUniqueClickCountByLink(linkId);
      const countryBreakdown = await this.clickEventService.getClickEventsByCountry(linkId);
      const deviceBreakdown = await this.clickEventService.getClickEventsByDevice(linkId);
      const browserBreakdown = await this.clickEventService.getClickEventsByBrowser(linkId);

      return {
        success: true,
        data: {
          linkId,
          totalClicks,
          uniqueClicks,
          recentClicks: clickEvents,
          breakdown: {
            countries: countryBreakdown,
            devices: deviceBreakdown,
            browsers: browserBreakdown,
          },
        },
        meta: {
          limit: limit || 100,
          offset: offset || 0,
          generatedAt: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get link analytics: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve link analytics');
    }
  }

  @Get('recent-clicks')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get recent click events',
    description: 'Returns the most recent click events across all links',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Recent clicks retrieved successfully',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of recent clicks to return',
  })
  async getRecentClicks(
    @CurrentUser() user: User,
    @Query('limit') limit?: number,
  ) {
    try {
      const recentClicks = await this.clickEventService.getRecentClickEvents(limit || 50);

      // Filter clicks for current user's links only
      const userClicks = recentClicks.filter(click => click.userId === user.id);

      return {
        success: true,
        data: userClicks,
        meta: {
          limit: limit || 50,
          count: userClicks.length,
          generatedAt: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get recent clicks: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve recent clicks');
    }
  }

  @Get('cache-stats')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get analytics cache statistics',
    description: 'Returns cache statistics for monitoring purposes',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cache statistics retrieved successfully',
  })
  async getCacheStats(@CurrentUser() user: User) {
    try {
      const cacheStats = this.deviceLocationDetectionService.getCacheStats();

      return {
        success: true,
        data: cacheStats,
        meta: {
          generatedAt: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get cache stats: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve cache statistics');
    }
  }
}