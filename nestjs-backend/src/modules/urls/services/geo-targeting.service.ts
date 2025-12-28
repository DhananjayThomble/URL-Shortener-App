import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { LinkRepository } from '../repositories/link.repository';
import { GeoRuleRepository } from '../repositories/geo-rule.repository';
import { IpGeolocationService } from './ip-geolocation.service';
import { GeoRule } from '../entities/geo-rule.entity';
import { Link } from '../entities/link.entity';

export interface GeoTargetingRule {
  countryCode: string;
  redirectUrl: string;
}

export interface GeoTargetingDecision {
  shouldRedirect: boolean;
  redirectUrl?: string;
  matchedRule?: GeoRule;
  detectedCountry?: string;
  fallbackToOriginal: boolean;
}

export interface GeoTargetingAnalytics {
  ipAddress: string;
  detectedCountry: string;
  countryCode: string;
  matchedRule?: string;
  redirectUrl: string;
  timestamp: Date;
}

@Injectable()
export class GeoTargetingService {
  private readonly logger = new Logger(GeoTargetingService.name);

  constructor(
    private readonly linkRepository: LinkRepository,
    private readonly geoRuleRepository: GeoRuleRepository,
    private readonly ipGeolocationService: IpGeolocationService,
  ) {}

  /**
   * Create geo-targeting rules for a link
   */
  async createGeoRules(
    linkId: string,
    userId: string,
    rules: GeoTargetingRule[],
  ): Promise<GeoRule[]> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new BadRequestException('Link not found or access denied');
    }

    // Validate rules
    this.validateGeoRules(rules);

    // Create geo rules
    const geoRules = rules.map(rule => ({
      linkId,
      countryCode: rule.countryCode.toUpperCase(),
      redirectUrl: rule.redirectUrl,
    }));

    const createdRules = await this.geoRuleRepository.bulkCreate(geoRules);
    
    this.logger.log(`Created ${createdRules.length} geo rules for link ${linkId}`);
    return createdRules;
  }

  /**
   * Update geo-targeting rules for a link
   */
  async updateGeoRules(
    linkId: string,
    userId: string,
    rules: GeoTargetingRule[],
  ): Promise<GeoRule[]> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new BadRequestException('Link not found or access denied');
    }

    // Validate rules
    this.validateGeoRules(rules);

    // Replace existing rules
    const newRules = rules.map(rule => ({
      countryCode: rule.countryCode.toUpperCase(),
      redirectUrl: rule.redirectUrl,
    }));

    const updatedRules = await this.geoRuleRepository.replaceRulesForLink(
      linkId,
      newRules,
    );

    this.logger.log(`Updated geo rules for link ${linkId}`);
    return updatedRules;
  }

  /**
   * Get geo-targeting rules for a link
   */
  async getGeoRules(linkId: string, userId: string): Promise<GeoRule[]> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new BadRequestException('Link not found or access denied');
    }

    return this.geoRuleRepository.findByLinkId(linkId);
  }

  /**
   * Delete all geo-targeting rules for a link
   */
  async deleteGeoRules(linkId: string, userId: string): Promise<void> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new BadRequestException('Link not found or access denied');
    }

    await this.geoRuleRepository.deleteByLinkId(linkId);
    this.logger.log(`Deleted geo rules for link ${linkId}`);
  }

  /**
   * Make geo-targeting decision for a link access
   */
  async makeGeoTargetingDecision(
    shortCode: string,
    ipAddress: string,
  ): Promise<GeoTargetingDecision> {
    try {
      // Get link with geo rules
      const link = await this.linkRepository.findActiveByShortCode(shortCode);
      
      if (!link) {
        throw new BadRequestException('Link not found or expired');
      }

      // If no geo rules exist, use original URL
      if (!link.geoRules || link.geoRules.length === 0) {
        return {
          shouldRedirect: false,
          fallbackToOriginal: true,
        };
      }

      // Get user's country from IP
      const countryCode = await this.ipGeolocationService.getCountryCode(ipAddress);
      
      if (!countryCode || countryCode === 'XX') {
        this.logger.warn(`Could not determine country for IP ${ipAddress}`);
        return {
          shouldRedirect: false,
          detectedCountry: 'Unknown',
          fallbackToOriginal: true,
        };
      }

      // Find matching geo rule
      const matchedRule = link.geoRules.find(
        rule => rule.countryCode === countryCode.toUpperCase()
      );

      if (matchedRule) {
        this.logger.log(
          `Geo-targeting match: ${shortCode} -> ${matchedRule.redirectUrl} (${countryCode})`
        );
        
        return {
          shouldRedirect: true,
          redirectUrl: matchedRule.redirectUrl,
          matchedRule,
          detectedCountry: countryCode,
          fallbackToOriginal: false,
        };
      }

      // No matching rule found, use original URL
      return {
        shouldRedirect: false,
        detectedCountry: countryCode,
        fallbackToOriginal: true,
      };

    } catch (error) {
      this.logger.error(
        `Error making geo-targeting decision for ${shortCode}:`,
        error
      );
      
      return {
        shouldRedirect: false,
        fallbackToOriginal: true,
      };
    }
  }

  /**
   * Get the appropriate redirect URL based on geo-targeting
   */
  async getRedirectUrl(
    shortCode: string,
    ipAddress: string,
  ): Promise<string> {
    const link = await this.linkRepository.findActiveByShortCode(shortCode);
    
    if (!link) {
      throw new BadRequestException('Link not found or expired');
    }

    const decision = await this.makeGeoTargetingDecision(shortCode, ipAddress);
    
    return decision.shouldRedirect && decision.redirectUrl
      ? decision.redirectUrl
      : link.originalUrl;
  }

  /**
   * Log geo-targeting analytics
   */
  async logGeoTargetingAnalytics(
    shortCode: string,
    ipAddress: string,
    decision: GeoTargetingDecision,
    finalRedirectUrl: string,
  ): Promise<GeoTargetingAnalytics> {
    const analytics: GeoTargetingAnalytics = {
      ipAddress: this.hashIpAddress(ipAddress),
      detectedCountry: decision.detectedCountry || 'Unknown',
      countryCode: decision.detectedCountry || 'XX',
      matchedRule: decision.matchedRule?.id,
      redirectUrl: finalRedirectUrl,
      timestamp: new Date(),
    };

    // In a production environment, you would store this in a dedicated analytics collection
    this.logger.log(`Geo-targeting analytics: ${JSON.stringify(analytics)}`);
    
    return analytics;
  }

  /**
   * Get geo-targeting statistics for a link
   */
  async getGeoTargetingStats(
    linkId: string,
    userId: string,
    period: string = '7d',
  ): Promise<any> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new BadRequestException('Link not found or access denied');
    }

    // This would typically query an analytics database
    // For now, return a placeholder structure
    return {
      linkId,
      period,
      totalClicks: 0,
      geoDistribution: {},
      rulePerformance: {},
      topCountries: [],
    };
  }

  /**
   * Validate geo-targeting rules
   */
  private validateGeoRules(rules: GeoTargetingRule[]): void {
    if (!rules || rules.length === 0) {
      throw new BadRequestException('At least one geo rule is required');
    }

    if (rules.length > 50) {
      throw new BadRequestException('Maximum 50 geo rules allowed per link');
    }

    const countryCodeSet = new Set<string>();

    for (const rule of rules) {
      // Validate country code
      if (!rule.countryCode || rule.countryCode.length !== 2) {
        throw new BadRequestException(
          'Country code must be a valid 2-letter ISO code'
        );
      }

      const upperCountryCode = rule.countryCode.toUpperCase();
      
      if (countryCodeSet.has(upperCountryCode)) {
        throw new BadRequestException(
          `Duplicate country code: ${upperCountryCode}`
        );
      }
      
      countryCodeSet.add(upperCountryCode);

      // Validate redirect URL
      if (!rule.redirectUrl) {
        throw new BadRequestException('Redirect URL is required');
      }

      try {
        new URL(rule.redirectUrl);
      } catch {
        throw new BadRequestException(
          `Invalid redirect URL: ${rule.redirectUrl}`
        );
      }
    }
  }

  /**
   * Hash IP address for privacy
   */
  private hashIpAddress(ipAddress: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(ipAddress + 'salt').digest('hex');
  }

  /**
   * Get supported country codes
   */
  getSupportedCountryCodes(): string[] {
    // ISO 3166-1 alpha-2 country codes
    return [
      'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT',
      'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI',
      'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY',
      'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
      'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM',
      'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK',
      'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL',
      'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
      'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR',
      'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN',
      'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS',
      'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
      'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW',
      'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP',
      'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM',
      'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
      'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM',
      'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF',
      'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW',
      'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
      'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW'
    ];
  }
}