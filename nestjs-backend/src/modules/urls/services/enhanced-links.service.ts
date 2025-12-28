import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { LinkRepository } from '../repositories/link.repository';
import { PasswordProtectionService } from './password-protection.service';
import { GeoTargetingService } from './geo-targeting.service';
import { DeviceDetectionService } from './device-detection.service';
import { UTMParameterService } from './utm-parameter.service';
import { TrackingPixelService } from './tracking-pixel.service';
import { EnhancedCreateUrlDto } from '../dto/enhanced-create-url.dto';
import { Link } from '../entities/link.entity';

export interface RedirectDecision {
  finalUrl: string;
  shouldRedirect: boolean;
  redirectReason?: string;
  analytics: {
    geoTargeting?: any;
    deviceDetection?: any;
    utmParameters?: any;
    trackingPixels?: any;
  };
}

@Injectable()
export class EnhancedLinksService {
  private readonly logger = new Logger(EnhancedLinksService.name);

  constructor(
    private readonly linkRepository: LinkRepository,
    private readonly passwordProtectionService: PasswordProtectionService,
    private readonly geoTargetingService: GeoTargetingService,
    private readonly deviceDetectionService: DeviceDetectionService,
    private readonly utmParameterService: UTMParameterService,
    private readonly trackingPixelService: TrackingPixelService,
  ) {}

  /**
   * Create an enhanced link with all advanced features
   */
  async createEnhancedLink(
    createUrlDto: EnhancedCreateUrlDto,
    userId: string,
  ): Promise<Link> {
    // Validate URL format
    if (!this.isValidUrl(createUrlDto.originalUrl)) {
      throw new BadRequestException('Invalid URL format');
    }

    // Generate or validate short code
    let shortCode: string;
    if (createUrlDto.customAlias) {
      const isAvailable = await this.linkRepository.isCustomAliasAvailable(
        createUrlDto.customAlias,
      );
      if (!isAvailable) {
        throw new BadRequestException('Custom alias already exists');
      }
      shortCode = createUrlDto.customAlias;
    } else {
      shortCode = await this.generateUniqueShortCode();
    }

    // Validate device-specific URLs
    if (createUrlDto.iosUrl || createUrlDto.androidUrl) {
      const validation = this.deviceDetectionService.validateDeviceUrls(
        createUrlDto.iosUrl,
        createUrlDto.androidUrl,
      );
      if (!validation.isValid) {
        throw new BadRequestException(`Device URL validation failed: ${validation.errors.join(', ')}`);
      }
    }

    // Validate UTM parameters
    if (createUrlDto.utmParameters) {
      const utmValidation = this.utmParameterService.validateUTMParameters(
        createUrlDto.utmParameters,
      );
      if (!utmValidation.isValid) {
        throw new BadRequestException(`UTM validation failed: ${utmValidation.errors.join(', ')}`);
      }
    }

    // Validate tracking pixels
    if (createUrlDto.trackingPixels) {
      const pixelValidation = this.trackingPixelService.validateTrackingPixelConfig(
        createUrlDto.trackingPixels,
      );
      if (!pixelValidation.isValid) {
        throw new BadRequestException(`Tracking pixel validation failed: ${pixelValidation.errors.join(', ')}`);
      }
    }

    // Create the link
    const linkData: Partial<Link> = {
      userId,
      originalUrl: createUrlDto.originalUrl,
      shortCode,
      customAlias: createUrlDto.customAlias,
      title: createUrlDto.title,
      expiresAt: createUrlDto.expiresAt,
      iosUrl: createUrlDto.iosUrl,
      androidUrl: createUrlDto.androidUrl,
      utmSource: createUrlDto.utmParameters?.utm_source,
      utmMedium: createUrlDto.utmParameters?.utm_medium,
      utmCampaign: createUrlDto.utmParameters?.utm_campaign,
      utmTerm: createUrlDto.utmParameters?.utm_term,
      utmContent: createUrlDto.utmParameters?.utm_content,
      metaPixelId: createUrlDto.trackingPixels?.metaPixelId,
      googleAnalyticsId: createUrlDto.trackingPixels?.googleAnalyticsId,
      tiktokPixelId: createUrlDto.trackingPixels?.tiktokPixelId,
      isActive: true,
    };

    // Hash password if provided
    if (createUrlDto.password) {
      linkData.passwordHash = await this.passwordProtectionService.hashPassword(
        createUrlDto.password,
      );
      linkData.passwordHint = createUrlDto.passwordHint;
    }

    const createdLink = await this.linkRepository.create(linkData);

    // Create geo-targeting rules if provided
    if (createUrlDto.geoTargetingRules && createUrlDto.geoTargetingRules.length > 0) {
      await this.geoTargetingService.createGeoRules(
        createdLink.id,
        userId,
        createUrlDto.geoTargetingRules,
      );
    }

    this.logger.log(`Enhanced link created: ${shortCode} -> ${createUrlDto.originalUrl}`);
    return createdLink;
  }

  /**
   * Make comprehensive redirect decision with all advanced features
   */
  async makeRedirectDecision(
    shortCode: string,
    ipAddress: string,
    userAgent: string,
    referrer?: string,
    password?: string,
  ): Promise<RedirectDecision> {
    const link = await this.linkRepository.findActiveByShortCode(shortCode);
    
    if (!link) {
      throw new NotFoundException('Link not found or expired');
    }

    const analytics: any = {};

    // 1. Password validation
    if (link.passwordHash) {
      const passwordValidation = await this.passwordProtectionService.validateLinkPassword(
        shortCode,
        password,
      );
      
      if (!passwordValidation.isValid) {
        throw new BadRequestException('Invalid or missing password');
      }
    }

    // 2. Geo-targeting decision
    let targetUrl = link.originalUrl;
    const geoDecision = await this.geoTargetingService.makeGeoTargetingDecision(
      shortCode,
      ipAddress,
    );
    
    if (geoDecision.shouldRedirect && geoDecision.redirectUrl) {
      targetUrl = geoDecision.redirectUrl;
      analytics.geoTargeting = geoDecision;
    }

    // 3. Device-specific routing
    const deviceDecision = this.deviceDetectionService.makeDeviceRoutingDecision(
      userAgent,
      targetUrl,
      link.iosUrl,
      link.androidUrl,
    );
    
    if (deviceDecision.shouldRedirect && deviceDecision.redirectUrl) {
      targetUrl = deviceDecision.redirectUrl;
    }
    analytics.deviceDetection = deviceDecision;

    // 4. UTM parameter handling
    const linkUTMParams = {
      utm_source: link.utmSource,
      utm_medium: link.utmMedium,
      utm_campaign: link.utmCampaign,
      utm_term: link.utmTerm,
      utm_content: link.utmContent,
    };

    const finalUrl = this.utmParameterService.buildRedirectUrlWithUTM(
      targetUrl,
      linkUTMParams,
      referrer,
    );
    analytics.utmParameters = linkUTMParams;

    // 5. Tracking pixel preparation
    if (link.metaPixelId || link.googleAnalyticsId || link.tiktokPixelId) {
      const trackingConfig = {
        metaPixelId: link.metaPixelId,
        googleAnalyticsId: link.googleAnalyticsId,
        tiktokPixelId: link.tiktokPixelId,
      };

      const trackingData = {
        eventType: 'click' as const,
        url: finalUrl,
        referrer,
        userAgent,
        timestamp: new Date(),
      };

      // Fire tracking pixels asynchronously
      this.trackingPixelService.fireTrackingPixels(trackingConfig, trackingData)
        .catch(error => {
          this.logger.error('Error firing tracking pixels:', error);
        });

      analytics.trackingPixels = trackingConfig;
    }

    return {
      finalUrl,
      shouldRedirect: true,
      redirectReason: this.buildRedirectReason(geoDecision, deviceDecision),
      analytics,
    };
  }

  /**
   * Get enhanced link by ID with all relationships
   */
  async getEnhancedLink(linkId: string, userId: string): Promise<Link> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new NotFoundException('Link not found or access denied');
    }

    return link;
  }

  /**
   * Update enhanced link
   */
  async updateEnhancedLink(
    linkId: string,
    userId: string,
    updateData: Partial<EnhancedCreateUrlDto>,
  ): Promise<Link> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new NotFoundException('Link not found or access denied');
    }

    // Validate updates
    if (updateData.originalUrl && !this.isValidUrl(updateData.originalUrl)) {
      throw new BadRequestException('Invalid URL format');
    }

    if (updateData.iosUrl || updateData.androidUrl) {
      const validation = this.deviceDetectionService.validateDeviceUrls(
        updateData.iosUrl,
        updateData.androidUrl,
      );
      if (!validation.isValid) {
        throw new BadRequestException(`Device URL validation failed: ${validation.errors.join(', ')}`);
      }
    }

    // Prepare update data
    const linkUpdateData: Partial<Link> = {
      originalUrl: updateData.originalUrl,
      title: updateData.title,
      expiresAt: updateData.expiresAt,
      iosUrl: updateData.iosUrl,
      androidUrl: updateData.androidUrl,
      utmSource: updateData.utmParameters?.utm_source,
      utmMedium: updateData.utmParameters?.utm_medium,
      utmCampaign: updateData.utmParameters?.utm_campaign,
      utmTerm: updateData.utmParameters?.utm_term,
      utmContent: updateData.utmParameters?.utm_content,
      metaPixelId: updateData.trackingPixels?.metaPixelId,
      googleAnalyticsId: updateData.trackingPixels?.googleAnalyticsId,
      tiktokPixelId: updateData.trackingPixels?.tiktokPixelId,
    };

    // Handle password updates
    if (updateData.password) {
      linkUpdateData.passwordHash = await this.passwordProtectionService.hashPassword(
        updateData.password,
      );
      linkUpdateData.passwordHint = updateData.passwordHint;
    }

    const updatedLink = await this.linkRepository.update(linkId, linkUpdateData);

    // Update geo-targeting rules if provided
    if (updateData.geoTargetingRules) {
      await this.geoTargetingService.updateGeoRules(
        linkId,
        userId,
        updateData.geoTargetingRules,
      );
    }

    this.logger.log(`Enhanced link updated: ${linkId}`);
    return updatedLink;
  }

  /**
   * Delete enhanced link
   */
  async deleteEnhancedLink(linkId: string, userId: string): Promise<void> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new NotFoundException('Link not found or access denied');
    }

    await this.linkRepository.delete(linkId);
    this.logger.log(`Enhanced link deleted: ${linkId}`);
  }

  /**
   * Generate unique short code
   */
  private async generateUniqueShortCode(): Promise<string> {
    let shortCode: string;
    let isUnique = false;

    while (!isUnique) {
      shortCode = nanoid(8);
      isUnique = await this.linkRepository.isShortCodeAvailable(shortCode);
    }

    return shortCode;
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Build redirect reason string
   */
  private buildRedirectReason(geoDecision: any, deviceDecision: any): string {
    const reasons: string[] = [];

    if (geoDecision.shouldRedirect) {
      reasons.push(`geo-targeting (${geoDecision.detectedCountry})`);
    }

    if (deviceDecision.shouldRedirect) {
      reasons.push(`device-specific (${deviceDecision.detectedDevice.type})`);
    }

    return reasons.length > 0 ? reasons.join(', ') : 'standard redirect';
  }
}