import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

export interface AnalyticsDeviceInfo {
  browser: string;
  browserVersion: string;
  device: 'desktop' | 'mobile' | 'tablet';
  os: string;
  osVersion: string;
  isBot: boolean;
  userAgent: string;
}

export interface AnalyticsLocationInfo {
  country: string;
  countryCode: string;
  city: string;
  region: string;
  timezone: string;
  latitude?: number;
  longitude?: number;
}

export interface AnalyticsDetectionResult {
  device: AnalyticsDeviceInfo;
  location: AnalyticsLocationInfo;
  ipHash: string;
  sessionId: string;
}

@Injectable()
export class DeviceLocationDetectionService {
  private readonly logger = new Logger(DeviceLocationDetectionService.name);
  private readonly locationCache = new Map<string, AnalyticsLocationInfo>();
  private readonly cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours

  constructor(private readonly configService: ConfigService) {}

  /**
   * Detect device and location information for analytics
   */
  async detectDeviceAndLocation(
    userAgent: string,
    ipAddress: string,
    sessionId?: string,
  ): Promise<AnalyticsDetectionResult> {
    const device = this.parseUserAgentForAnalytics(userAgent);
    const location = await this.getLocationForAnalytics(ipAddress);
    const ipHash = this.hashIpAddress(ipAddress);
    const finalSessionId = sessionId || this.generateSessionId(userAgent, ipAddress);

    return {
      device,
      location,
      ipHash,
      sessionId: finalSessionId,
    };
  }

  /**
   * Parse user agent specifically for analytics tracking
   */
  parseUserAgentForAnalytics(userAgent: string): AnalyticsDeviceInfo {
    if (!userAgent) {
      return this.getDefaultAnalyticsDeviceInfo();
    }

    const ua = userAgent.toLowerCase();

    return {
      browser: this.detectBrowser(ua),
      browserVersion: this.detectBrowserVersion(ua),
      device: this.detectDeviceType(ua),
      os: this.detectOS(ua),
      osVersion: this.detectOSVersion(ua),
      isBot: this.isBotUserAgent(ua),
      userAgent: userAgent,
    };
  }

  /**
   * Get location information for analytics
   */
  async getLocationForAnalytics(ipAddress: string): Promise<AnalyticsLocationInfo> {
    try {
      // Check cache first
      const ipHash = this.hashIpAddress(ipAddress);
      const cached = this.locationCache.get(ipHash);
      if (cached) {
        return cached;
      }

      // Handle private/localhost IPs
      if (this.isPrivateOrLocalhost(ipAddress)) {
        const defaultLocation: AnalyticsLocationInfo = {
          country: 'Unknown',
          countryCode: 'XX',
          city: 'Unknown',
          region: 'Unknown',
          timezone: 'Unknown',
        };
        return defaultLocation;
      }

      // Get location from geolocation service
      const location = await this.fetchLocationData(ipAddress);
      
      // Cache the result
      this.locationCache.set(ipHash, location);
      setTimeout(() => {
        this.locationCache.delete(ipHash);
      }, this.cacheExpiry);

      return location;
    } catch (error) {
      this.logger.error(`Failed to get location for IP ${ipAddress}: ${error.message}`);
      return {
        country: 'Unknown',
        countryCode: 'XX',
        city: 'Unknown',
        region: 'Unknown',
        timezone: 'Unknown',
      };
    }
  }

  /**
   * Hash IP address for privacy
   */
  hashIpAddress(ipAddress: string): string {
    const salt = this.configService.get<string>('IP_HASH_SALT', 'default-salt');
    return crypto
      .createHash('sha256')
      .update(ipAddress + salt)
      .digest('hex')
      .substring(0, 16); // Use first 16 characters for storage efficiency
  }

  /**
   * Generate session ID for tracking unique visitors
   */
  generateSessionId(userAgent: string, ipAddress: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2);
    const hash = crypto
      .createHash('md5')
      .update(userAgent + ipAddress + timestamp + random)
      .digest('hex')
      .substring(0, 12);
    
    return `sess_${hash}`;
  }

  /**
   * Detect browser from user agent
   */
  private detectBrowser(ua: string): string {
    if (/edg/i.test(ua)) return 'Edge';
    if (/chrome/i.test(ua) && !/edg/i.test(ua)) return 'Chrome';
    if (/firefox/i.test(ua)) return 'Firefox';
    if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
    if (/opera|opr/i.test(ua)) return 'Opera';
    if (/msie|trident/i.test(ua)) return 'Internet Explorer';
    if (/samsung/i.test(ua)) return 'Samsung Browser';
    if (/ucbrowser/i.test(ua)) return 'UC Browser';
    return 'Other';
  }

  /**
   * Detect browser version
   */
  private detectBrowserVersion(ua: string): string {
    try {
      let match: RegExpMatchArray | null = null;

      if (/edg/i.test(ua)) {
        match = ua.match(/edg\/([0-9.]+)/i);
      } else if (/chrome/i.test(ua) && !/edg/i.test(ua)) {
        match = ua.match(/chrome\/([0-9.]+)/i);
      } else if (/firefox/i.test(ua)) {
        match = ua.match(/firefox\/([0-9.]+)/i);
      } else if (/safari/i.test(ua) && !/chrome/i.test(ua)) {
        match = ua.match(/version\/([0-9.]+)/i);
      } else if (/opera|opr/i.test(ua)) {
        match = ua.match(/(?:opera|opr)\/([0-9.]+)/i);
      } else if (/msie|trident/i.test(ua)) {
        match = ua.match(/(?:msie |rv:)([0-9.]+)/i);
      }

      return match ? match[1].split('.')[0] : 'Unknown'; // Return major version only
    } catch (error) {
      return 'Unknown';
    }
  }

  /**
   * Detect device type
   */
  private detectDeviceType(ua: string): 'desktop' | 'mobile' | 'tablet' {
    // Check for tablet first
    if (/ipad|android(?!.*mobile)|tablet|kindle|silk|playbook/i.test(ua)) {
      return 'tablet';
    }

    // Check for mobile
    if (/mobile|android|iphone|ipod|blackberry|windows phone|opera mini|iemobile/i.test(ua)) {
      return 'mobile';
    }

    return 'desktop';
  }

  /**
   * Detect operating system
   */
  private detectOS(ua: string): string {
    if (/windows nt/i.test(ua)) return 'Windows';
    if (/mac os x/i.test(ua)) return 'macOS';
    if (/linux/i.test(ua)) return 'Linux';
    if (/android/i.test(ua)) return 'Android';
    if (/iphone os|ios/i.test(ua)) return 'iOS';
    if (/cros/i.test(ua)) return 'Chrome OS';
    return 'Other';
  }

  /**
   * Detect OS version (simplified for analytics)
   */
  private detectOSVersion(ua: string): string {
    try {
      if (/windows nt ([0-9.]+)/i.test(ua)) {
        const match = ua.match(/windows nt ([0-9.]+)/i);
        if (match) {
          const version = match[1];
          const windowsVersions: { [key: string]: string } = {
            '10.0': '10',
            '6.3': '8.1',
            '6.2': '8',
            '6.1': '7',
          };
          return windowsVersions[version] || 'Other';
        }
      }

      if (/mac os x ([0-9_]+)/i.test(ua)) {
        const match = ua.match(/mac os x ([0-9_]+)/i);
        if (match) {
          const version = match[1].replace(/_/g, '.').split('.').slice(0, 2).join('.');
          return version;
        }
      }

      if (/android ([0-9.]+)/i.test(ua)) {
        const match = ua.match(/android ([0-9.]+)/i);
        if (match) {
          return match[1].split('.')[0]; // Return major version only
        }
      }

      if (/os ([0-9_]+)/i.test(ua)) {
        const match = ua.match(/os ([0-9_]+)/i);
        if (match) {
          return match[1].replace(/_/g, '.').split('.').slice(0, 2).join('.');
        }
      }
    } catch (error) {
      // Ignore parsing errors
    }

    return 'Unknown';
  }

  /**
   * Check if user agent indicates a bot
   */
  private isBotUserAgent(ua: string): boolean {
    const botPatterns = [
      /bot/i, /crawler/i, /spider/i, /scraper/i,
      /facebook/i, /twitter/i, /linkedin/i, /whatsapp/i,
      /googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i,
      /baiduspider/i, /yandexbot/i, /facebookexternalhit/i,
      /twitterbot/i, /linkedinbot/i, /pinterest/i,
      /telegrambot/i, /slackbot/i, /discordbot/i,
    ];

    return botPatterns.some(pattern => pattern.test(ua));
  }

  /**
   * Fetch location data from geolocation service
   */
  private async fetchLocationData(ipAddress: string): Promise<AnalyticsLocationInfo> {
    try {
      // Try ip-api.com first (free service)
      const response = await axios.get(
        `http://ip-api.com/json/${ipAddress}?fields=status,country,countryCode,city,regionName,timezone,lat,lon`,
        { timeout: 3000 }
      );

      if (response.data.status === 'success') {
        return {
          country: response.data.country || 'Unknown',
          countryCode: response.data.countryCode || 'XX',
          city: response.data.city || 'Unknown',
          region: response.data.regionName || 'Unknown',
          timezone: response.data.timezone || 'Unknown',
          latitude: response.data.lat,
          longitude: response.data.lon,
        };
      }
    } catch (error) {
      this.logger.warn(`ip-api.com failed for ${ipAddress}: ${error.message}`);
    }

    // Fallback to default
    return {
      country: 'Unknown',
      countryCode: 'XX',
      city: 'Unknown',
      region: 'Unknown',
      timezone: 'Unknown',
    };
  }

  /**
   * Check if IP is private or localhost
   */
  private isPrivateOrLocalhost(ipAddress: string): boolean {
    if (!ipAddress) return true;
    
    // Localhost
    if (ipAddress === '127.0.0.1' || ipAddress === '::1' || ipAddress === 'localhost') {
      return true;
    }

    // Private IP ranges
    const privateRanges = [
      /^10\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./,
      /^169\.254\./, /^fc00:/, /^fe80:/,
    ];

    return privateRanges.some(range => range.test(ipAddress));
  }

  /**
   * Get default device info
   */
  private getDefaultAnalyticsDeviceInfo(): AnalyticsDeviceInfo {
    return {
      browser: 'Unknown',
      browserVersion: 'Unknown',
      device: 'desktop',
      os: 'Unknown',
      osVersion: 'Unknown',
      isBot: false,
      userAgent: '',
    };
  }

  /**
   * Clear location cache
   */
  clearLocationCache(): void {
    this.locationCache.clear();
    this.logger.log('Location cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { locationCacheSize: number } {
    return {
      locationCacheSize: this.locationCache.size,
    };
  }
}