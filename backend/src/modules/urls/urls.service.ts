import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { nanoid } from 'nanoid';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';

import { Url, UrlDocument } from './schemas/url.schema';
import { ClickAnalytics, ClickAnalyticsDocument } from './schemas/click-analytics.schema';
import { UrlStats, UrlStatsDocument } from './schemas/url-stats.schema';
import { CreateUrlDto } from './dto/create-url.dto';
import { UpdateUrlDto } from './dto/update-url.dto';
import { QRCodeOptionsDto } from './dto/qr-code-options.dto';
import { CacheService } from '../../common/services/cache.service';
import { AuditLogService } from '../users/services/audit-log.service';

@Injectable()
export class UrlsService {
  private readonly logger = new Logger(UrlsService.name);

  constructor(
    @InjectModel(Url.name) private urlModel: Model<UrlDocument>,
    @InjectModel(ClickAnalytics.name) private clickAnalyticsModel: Model<ClickAnalyticsDocument>,
    @InjectModel(UrlStats.name) private urlStatsModel: Model<UrlStatsDocument>,
    private cacheService: CacheService,
    private auditLogService: AuditLogService,
    private configService: ConfigService,
  ) {}

  async create(createUrlDto: CreateUrlDto, userId: string): Promise<UrlDocument> {
    try {
      this.logger.debug(`Creating URL for user ${userId}: ${JSON.stringify(createUrlDto)}`);
      
      // Validate URL format
      if (!this.isValidUrl(createUrlDto.originalUrl)) {
        throw new BadRequestException('Invalid URL format');
      }

    // Generate short code
    let shortCode: string;
    if (createUrlDto.customBackHalf) {
      if (!this.isValidCustomBackHalf(createUrlDto.customBackHalf)) {
        throw new BadRequestException('Invalid custom back-half format');
      }
      
      // Check if custom back-half is available
      const existingUrl = await this.urlModel.findOne({ 
        shortCode: createUrlDto.customBackHalf 
      });
      
      if (existingUrl) {
        throw new BadRequestException('Custom back-half already exists');
      }
      
      shortCode = createUrlDto.customBackHalf;
    } else {
      shortCode = await this.generateUniqueShortCode();
    }

    // Extract metadata (title, description, favicon)
    const metadata = await this.extractUrlMetadata(createUrlDto.originalUrl);

    // Process tags if provided
    const tags = createUrlDto.tags?.map(tag => ({
      name: tag.name.toLowerCase().trim(),
      value: tag.value.trim(),
    })) || [];

    const url = new this.urlModel({
      userId,
      shortCode,
      originalUrl: createUrlDto.originalUrl,
      customBackHalf: createUrlDto.customBackHalf,
      category: createUrlDto.category,
      expiresAt: createUrlDto.expiresAt,
      metadata,
      tags,
      isActive: true,
    });

    const savedUrl = await url.save();

    // Cache the URL for quick access
    await this.cacheService.set(
      this.cacheService.generateUrlCacheKey(shortCode),
      savedUrl.originalUrl,
      3600, // 1 hour TTL
    );

    // Log URL creation
    await this.auditLogService.logUrlCreated(
      userId,
      savedUrl._id.toString(),
      'system',
      {
        shortCode,
        originalUrl: createUrlDto.originalUrl,
        category: createUrlDto.category,
      }
    );

    this.logger.log(`URL created: ${shortCode} -> ${createUrlDto.originalUrl}`);

    return savedUrl;
    } catch (error) {
      this.logger.error(`Error creating URL for user ${userId}:`, error.stack);
      throw error;
    }
  }

  async findAll(userId: string, page = 1, limit = 10): Promise<{ urls: UrlDocument[]; total: number }> {
    const skip = (page - 1) * limit;
    
    const [urls, total] = await Promise.all([
      this.urlModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.urlModel.countDocuments({ userId }),
    ]);

    return { urls, total };
  }

  async findOne(id: string, userId: string): Promise<UrlDocument> {
    const url = await this.urlModel.findOne({ _id: id, userId });
    
    if (!url) {
      throw new NotFoundException(`URL with ID ${id} not found`);
    }

    return url;
  }

  async findByShortCode(shortCode: string): Promise<string> {
    // Try cache first
    const cachedUrl = await this.cacheService.get<string>(
      this.cacheService.generateUrlCacheKey(shortCode)
    );
    
    if (cachedUrl) {
      return cachedUrl;
    }

    // Fallback to database
    const url = await this.urlModel.findOne({ 
      shortCode, 
      isActive: true,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } }
      ]
    });

    if (!url) {
      throw new NotFoundException('URL not found or expired');
    }

    // Cache for future requests
    await this.cacheService.set(
      this.cacheService.generateUrlCacheKey(shortCode),
      url.originalUrl,
      3600,
    );

    return url.originalUrl;
  }

  async update(id: string, updateUrlDto: UpdateUrlDto, userId: string): Promise<UrlDocument> {
    const url = await this.findOne(id, userId);

    if (updateUrlDto.originalUrl && !this.isValidUrl(updateUrlDto.originalUrl)) {
      throw new BadRequestException('Invalid URL format');
    }

    Object.assign(url, updateUrlDto);
    const updatedUrl = await this.urlModel.findByIdAndUpdate(url._id, updateUrlDto, { new: true });

    // Update cache if URL changed
    if (updateUrlDto.originalUrl) {
      await this.cacheService.set(
        this.cacheService.generateUrlCacheKey(url.shortCode),
        updateUrlDto.originalUrl,
        3600,
      );
    }

    return updatedUrl;
  }

  async remove(id: string, userId: string): Promise<void> {
    const url = await this.findOne(id, userId);
    
    // Remove from cache
    await this.cacheService.del(
      this.cacheService.generateUrlCacheKey(url.shortCode)
    );

    await this.urlModel.deleteOne({ _id: id, userId });
  }

  async incrementVisitCount(shortCode: string): Promise<void> {
    await this.urlModel.updateOne(
      { shortCode },
      { $inc: { visitCount: 1 } }
    );
  }

  async trackClick(shortCode: string, clickData: any): Promise<void> {
    const url = await this.urlModel.findOne({ shortCode });
    
    if (url) {
      // Enhanced click data processing
      const processedClickData = await this.processClickData(clickData);
      
      const analytics = new this.clickAnalyticsModel({
        urlId: url._id,
        userId: url.userId,
        timestamp: new Date(),
        ipAddress: this.hashIpAddress(clickData.ipAddress),
        ...processedClickData,
      });

      await analytics.save();
      await this.incrementVisitCount(shortCode);
      
      // Update daily statistics
      await this.updateDailyStats(url._id, url.userId, processedClickData);
    }
  }

  async getUrlAnalytics(id: string, userId: string, period = '7d'): Promise<any> {
    const url = await this.findOne(id, userId);
    
    const startDate = this.getStartDateForPeriod(period);
    
    // Get click analytics
    const clickAnalytics = await this.clickAnalyticsModel.aggregate([
      {
        $match: {
          urlId: url._id,
          timestamp: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          },
          clicks: { $sum: 1 },
          uniqueClicks: { $addToSet: '$ipAddress' },
        },
      },
      {
        $project: {
          date: '$_id.date',
          clicks: 1,
          uniqueClicks: { $size: '$uniqueClicks' },
        },
      },
      { $sort: { date: 1 } },
    ]);

    // Get geographic distribution
    const geoAnalytics = await this.clickAnalyticsModel.aggregate([
      {
        $match: {
          urlId: url._id,
          timestamp: { $gte: startDate },
          country: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: '$country',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Get device analytics
    const deviceAnalytics = await this.clickAnalyticsModel.aggregate([
      {
        $match: {
          urlId: url._id,
          timestamp: { $gte: startDate },
          device: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: '$device',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    return {
      url: {
        id: url._id,
        shortCode: url.shortCode,
        originalUrl: url.originalUrl,
        totalClicks: url.visitCount,
        createdAt: url.createdAt,
      },
      analytics: {
        period,
        clicksByDate: clickAnalytics,
        geoDistribution: geoAnalytics,
        deviceDistribution: deviceAnalytics,
      },
    };
  }

  async generateQrCode(
    id: string,
    userId: string,
    options: QRCodeOptionsDto = {},
  ): Promise<{ qrCodeUrl: string; format: string; size: number }> {
    const url = await this.findOne(id, userId);
    const baseUrl = this.configService.get<string>('baseUrl', 'http://localhost:3000');
    const shortUrl = new URL(`/r/${url.shortCode}`, baseUrl).toString();
    const format = options.format ?? 'png';
    const size = options.size ?? 256;

    const qrOptions: QRCode.QRCodeToDataURLOptions & QRCode.QRCodeToStringOptions = {
      errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
      margin: options.margin ?? 2,
      color: options.color,
      width: size,
    };

    let qrCodeUrl: string;

    if (format === 'svg') {
      const svg = await QRCode.toString(shortUrl, { ...qrOptions, type: 'svg' });
      const encodedSvg = Buffer.from(svg).toString('base64');
      qrCodeUrl = `data:image/svg+xml;base64,${encodedSvg}`;
    } else {
      qrCodeUrl = await QRCode.toDataURL(shortUrl, qrOptions);
    }

    return {
      qrCodeUrl,
      format,
      size,
    };
  }

  async bulkCreate(urls: CreateUrlDto[], userId: string): Promise<UrlDocument[]> {
    const results: UrlDocument[] = [];
    const errors: string[] = [];

    for (const urlDto of urls) {
      try {
        const url = await this.create(urlDto, userId);
        results.push(url);
      } catch (error) {
        errors.push(`Failed to create ${urlDto.originalUrl}: ${error.message}`);
      }
    }

    if (errors.length > 0) {
      this.logger.warn(`Bulk create completed with ${errors.length} errors`);
    }

    return results;
  }

  async findByCategory(userId: string, category: string, page = 1, limit = 10): Promise<{ urls: UrlDocument[]; total: number }> {
    const skip = (page - 1) * limit;
    
    const [urls, total] = await Promise.all([
      this.urlModel
        .find({ userId, category })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.urlModel.countDocuments({ userId, category }),
    ]);

    return { urls, total };
  }

  async findByTags(userId: string, tags: string[], page = 1, limit = 10): Promise<{ urls: UrlDocument[]; total: number }> {
    const skip = (page - 1) * limit;
    
    const [urls, total] = await Promise.all([
      this.urlModel
        .find({
          userId,
          'tags.name': { $in: tags.map(tag => tag.toLowerCase()) },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.urlModel.countDocuments({
        userId,
        'tags.name': { $in: tags.map(tag => tag.toLowerCase()) },
      }),
    ]);

    return { urls, total };
  }

  async setUrlPassword(id: string, userId: string, password: string): Promise<UrlDocument> {
    const url = await this.findOne(id, userId);
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    url.protection = {
      password: hashedPassword,
      expiresAt: undefined, // Password doesn't expire by default
    };

    return this.urlModel.findByIdAndUpdate(url._id, { protection: url.protection }, { new: true });
  }

  async validateUrlPassword(shortCode: string, password: string): Promise<boolean> {
    const url = await this.urlModel.findOne({ shortCode, isActive: true });
    
    if (!url || !url.protection?.password) {
      return true; // No password protection
    }

    return bcrypt.compare(password, url.protection.password);
  }

  async deactivateUrl(id: string, userId: string): Promise<UrlDocument> {
    const url = await this.findOne(id, userId);
    url.isActive = false;
    
    // Remove from cache
    await this.cacheService.del(
      this.cacheService.generateUrlCacheKey(url.shortCode)
    );

    return this.urlModel.findByIdAndUpdate(url._id, { isActive: false }, { new: true });
  }

  async reactivateUrl(id: string, userId: string): Promise<UrlDocument> {
    const url = await this.findOne(id, userId);
    url.isActive = true;
    
    // Add back to cache
    await this.cacheService.set(
      this.cacheService.generateUrlCacheKey(url.shortCode),
      url.originalUrl,
      3600,
    );

    return this.urlModel.findByIdAndUpdate(url._id, { isActive: true }, { new: true });
  }

  async getPopularUrls(userId: string, limit = 10): Promise<UrlDocument[]> {
    return this.urlModel
      .find({ userId, isActive: true })
      .sort({ visitCount: -1 })
      .limit(limit)
      .exec();
  }

  async cleanupExpiredUrls(): Promise<number> {
    const result = await this.urlModel.deleteMany({
      expiresAt: { $lt: new Date() },
    });

    this.logger.log(`Cleaned up ${result.deletedCount} expired URLs`);
    return result.deletedCount;
  }

  private async generateUniqueShortCode(): Promise<string> {
    let shortCode: string;
    let isUnique = false;

    while (!isUnique) {
      shortCode = nanoid(8);
      const existingUrl = await this.urlModel.findOne({ shortCode });
      isUnique = !existingUrl;
    }

    return shortCode;
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private isValidCustomBackHalf(backHalf: string): boolean {
    // Allow alphanumeric characters, hyphens, and underscores
    const regex = /^[a-zA-Z0-9_-]+$/;
    return regex.test(backHalf) && backHalf.length >= 3 && backHalf.length <= 50;
  }

  private async extractUrlMetadata(url: string): Promise<any> {
    try {
      // In a production environment, you would use a service like Puppeteer or a metadata API
      // For now, we'll return a basic structure and extract domain info
      const urlObj = new URL(url);
      
      return {
        title: null, // Would be extracted from <title> tag
        description: null, // Would be extracted from meta description
        favicon: `${urlObj.protocol}//${urlObj.host}/favicon.ico`,
        image: null, // Would be extracted from og:image
        siteName: urlObj.hostname,
      };
    } catch (error) {
      this.logger.warn(`Failed to extract metadata for ${url}: ${error.message}`);
      return {
        title: null,
        description: null,
        favicon: null,
        image: null,
        siteName: null,
      };
    }
  }

  private async processClickData(clickData: any): Promise<any> {
    // Process and enhance click data
    const userAgent = clickData.userAgent || '';
    
    return {
      userAgent,
      referer: clickData.referer || '',
      country: clickData.country || 'Unknown',
      city: clickData.city || 'Unknown',
      region: clickData.region || 'Unknown',
      timezone: clickData.timezone || 'Unknown',
      device: this.detectDevice(userAgent),
      browser: this.detectBrowser(userAgent),
      browserVersion: this.detectBrowserVersion(userAgent),
      os: this.detectOS(userAgent),
      osVersion: this.detectOSVersion(userAgent),
      isMobile: this.isMobileDevice(userAgent),
      isBot: this.isBotUserAgent(userAgent),
      language: clickData.language || 'Unknown',
      screenResolution: clickData.screenResolution || 'Unknown',
      customDomain: clickData.customDomain,
      utmParameters: this.extractUtmParameters(clickData.referer),
    };
  }

  private hashIpAddress(ipAddress: string): string {
    // Hash IP address for privacy compliance
    return crypto.createHash('sha256').update(ipAddress + 'salt').digest('hex');
  }

  private detectDevice(userAgent: string): string {
    if (/Mobile|Android|iPhone|iPad/.test(userAgent)) {
      if (/iPad/.test(userAgent)) return 'Tablet';
      return 'Mobile';
    }
    return 'Desktop';
  }

  private detectBrowser(userAgent: string): string {
    if (/Chrome/.test(userAgent) && !/Edge/.test(userAgent)) return 'Chrome';
    if (/Firefox/.test(userAgent)) return 'Firefox';
    if (/Safari/.test(userAgent) && !/Chrome/.test(userAgent)) return 'Safari';
    if (/Edge/.test(userAgent)) return 'Edge';
    if (/Opera/.test(userAgent)) return 'Opera';
    return 'Unknown';
  }

  private detectBrowserVersion(userAgent: string): string {
    const match = userAgent.match(/(Chrome|Firefox|Safari|Edge|Opera)\/([0-9.]+)/);
    return match ? match[2] : 'Unknown';
  }

  private detectOS(userAgent: string): string {
    if (/Windows/.test(userAgent)) return 'Windows';
    if (/Mac OS/.test(userAgent)) return 'macOS';
    if (/Linux/.test(userAgent)) return 'Linux';
    if (/Android/.test(userAgent)) return 'Android';
    if (/iOS/.test(userAgent)) return 'iOS';
    return 'Unknown';
  }

  private detectOSVersion(userAgent: string): string {
    const windowsMatch = userAgent.match(/Windows NT ([0-9.]+)/);
    if (windowsMatch) return windowsMatch[1];
    
    const macMatch = userAgent.match(/Mac OS X ([0-9_]+)/);
    if (macMatch) return macMatch[1].replace(/_/g, '.');
    
    return 'Unknown';
  }

  private isMobileDevice(userAgent: string): boolean {
    return /Mobile|Android|iPhone/.test(userAgent);
  }

  private isBotUserAgent(userAgent: string): boolean {
    const botPatterns = [
      'bot', 'crawler', 'spider', 'scraper', 'facebook', 'twitter',
      'linkedin', 'whatsapp', 'telegram', 'slack', 'discord'
    ];
    
    return botPatterns.some(pattern => 
      userAgent.toLowerCase().includes(pattern)
    );
  }

  private extractUtmParameters(referer: string): any {
    if (!referer) return {};
    
    try {
      const url = new URL(referer);
      const params = url.searchParams;
      
      return {
        utm_source: params.get('utm_source'),
        utm_medium: params.get('utm_medium'),
        utm_campaign: params.get('utm_campaign'),
        utm_term: params.get('utm_term'),
        utm_content: params.get('utm_content'),
      };
    } catch {
      return {};
    }
  }

  private async updateDailyStats(urlId: any, userId: string, clickData: any): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const statsUpdate = {
      $inc: {
        totalClicks: 1,
        uniqueClicks: clickData.isBot ? 0 : 1,
        botClicks: clickData.isBot ? 1 : 0,
      },
      $addToSet: {
        clicksByCountry: { country: clickData.country, count: 1 },
        clicksByDevice: { device: clickData.device, count: 1 },
        clicksByBrowser: { browser: clickData.browser, count: 1 },
      },
    };

    await this.urlStatsModel.updateOne(
      {
        urlId,
        userId,
        date: today,
        period: 'daily',
      },
      statsUpdate,
      { upsert: true }
    );
  }

  private getStartDateForPeriod(period: string): Date {
    const now = new Date();
    
    switch (period) {
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '90d':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
  }
}
