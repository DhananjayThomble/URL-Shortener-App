import { Injectable, Logger } from '@nestjs/common';

export interface DeviceInfo {
  type: 'mobile' | 'tablet' | 'desktop';
  os: string;
  osVersion: string;
  browser: string;
  browserVersion: string;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isBot: boolean;
}

export interface DeviceRoutingDecision {
  shouldRedirect: boolean;
  redirectUrl?: string;
  detectedDevice: DeviceInfo;
  routingReason?: string;
}

@Injectable()
export class DeviceDetectionService {
  private readonly logger = new Logger(DeviceDetectionService.name);

  /**
   * Parse user agent string and extract device information
   */
  parseUserAgent(userAgent: string): DeviceInfo {
    if (!userAgent) {
      return this.getDefaultDeviceInfo();
    }

    const ua = userAgent.toLowerCase();

    // Detect device type
    const isMobile = this.isMobileDevice(ua);
    const isTablet = this.isTabletDevice(ua);
    const isDesktop = !isMobile && !isTablet;

    // Detect OS
    const os = this.detectOS(ua);
    const osVersion = this.detectOSVersion(ua, os);

    // Detect browser
    const browser = this.detectBrowser(ua);
    const browserVersion = this.detectBrowserVersion(ua, browser);

    // Platform-specific detection
    const isIOS = this.isIOSDevice(ua);
    const isAndroid = this.isAndroidDevice(ua);
    const isBot = this.isBotUserAgent(ua);

    return {
      type: isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop',
      os,
      osVersion,
      browser,
      browserVersion,
      isMobile,
      isTablet,
      isDesktop,
      isIOS,
      isAndroid,
      isBot,
    };
  }

  /**
   * Make device routing decision based on link configuration
   */
  makeDeviceRoutingDecision(
    userAgent: string,
    originalUrl: string,
    iosUrl?: string,
    androidUrl?: string,
  ): DeviceRoutingDecision {
    const deviceInfo = this.parseUserAgent(userAgent);

    // If it's a bot, don't redirect
    if (deviceInfo.isBot) {
      return {
        shouldRedirect: false,
        detectedDevice: deviceInfo,
        routingReason: 'Bot detected, using original URL',
      };
    }

    // iOS device routing
    if (deviceInfo.isIOS && iosUrl) {
      return {
        shouldRedirect: true,
        redirectUrl: iosUrl,
        detectedDevice: deviceInfo,
        routingReason: 'iOS device detected, redirecting to iOS URL',
      };
    }

    // Android device routing
    if (deviceInfo.isAndroid && androidUrl) {
      return {
        shouldRedirect: true,
        redirectUrl: androidUrl,
        detectedDevice: deviceInfo,
        routingReason: 'Android device detected, redirecting to Android URL',
      };
    }

    // No specific routing needed
    return {
      shouldRedirect: false,
      detectedDevice: deviceInfo,
      routingReason: 'No device-specific URL configured or desktop device',
    };
  }

  /**
   * Get the appropriate redirect URL based on device detection
   */
  getDeviceSpecificUrl(
    userAgent: string,
    originalUrl: string,
    iosUrl?: string,
    androidUrl?: string,
  ): string {
    const decision = this.makeDeviceRoutingDecision(
      userAgent,
      originalUrl,
      iosUrl,
      androidUrl,
    );

    return decision.shouldRedirect && decision.redirectUrl
      ? decision.redirectUrl
      : originalUrl;
  }

  /**
   * Check if user agent indicates a mobile device
   */
  private isMobileDevice(ua: string): boolean {
    const mobilePatterns = [
      /mobile/i,
      /android/i,
      /iphone/i,
      /ipod/i,
      /blackberry/i,
      /windows phone/i,
      /opera mini/i,
      /iemobile/i,
      /mobile safari/i,
    ];

    return mobilePatterns.some(pattern => pattern.test(ua));
  }

  /**
   * Check if user agent indicates a tablet device
   */
  private isTabletDevice(ua: string): boolean {
    const tabletPatterns = [
      /ipad/i,
      /android(?!.*mobile)/i,
      /tablet/i,
      /kindle/i,
      /silk/i,
      /playbook/i,
    ];

    return tabletPatterns.some(pattern => pattern.test(ua));
  }

  /**
   * Check if user agent indicates an iOS device
   */
  private isIOSDevice(ua: string): boolean {
    return /iphone|ipad|ipod/i.test(ua);
  }

  /**
   * Check if user agent indicates an Android device
   */
  private isAndroidDevice(ua: string): boolean {
    return /android/i.test(ua);
  }

  /**
   * Check if user agent indicates a bot/crawler
   */
  private isBotUserAgent(ua: string): boolean {
    const botPatterns = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /scraper/i,
      /facebook/i,
      /twitter/i,
      /linkedin/i,
      /whatsapp/i,
      /telegram/i,
      /slack/i,
      /discord/i,
      /googlebot/i,
      /bingbot/i,
      /slurp/i,
      /duckduckbot/i,
      /baiduspider/i,
      /yandexbot/i,
      /facebookexternalhit/i,
      /twitterbot/i,
      /linkedinbot/i,
      /pinterest/i,
      /skypeuripreview/i,
      /whatsapp/i,
      /telegrambot/i,
    ];

    return botPatterns.some(pattern => pattern.test(ua));
  }

  /**
   * Detect operating system from user agent
   */
  private detectOS(ua: string): string {
    if (/windows nt/i.test(ua)) return 'Windows';
    if (/mac os x/i.test(ua)) return 'macOS';
    if (/linux/i.test(ua)) return 'Linux';
    if (/android/i.test(ua)) return 'Android';
    if (/iphone os|ios/i.test(ua)) return 'iOS';
    if (/cros/i.test(ua)) return 'Chrome OS';
    if (/ubuntu/i.test(ua)) return 'Ubuntu';
    if (/debian/i.test(ua)) return 'Debian';
    if (/fedora/i.test(ua)) return 'Fedora';
    if (/centos/i.test(ua)) return 'CentOS';
    return 'Unknown';
  }

  /**
   * Detect OS version from user agent
   */
  private detectOSVersion(ua: string, os: string): string {
    try {
      switch (os) {
        case 'Windows':
          const windowsMatch = ua.match(/windows nt ([0-9.]+)/i);
          if (windowsMatch) {
            const version = windowsMatch[1];
            const windowsVersions: { [key: string]: string } = {
              '10.0': '10',
              '6.3': '8.1',
              '6.2': '8',
              '6.1': '7',
              '6.0': 'Vista',
              '5.1': 'XP',
            };
            return windowsVersions[version] || version;
          }
          break;

        case 'macOS':
          const macMatch = ua.match(/mac os x ([0-9_]+)/i);
          if (macMatch) {
            return macMatch[1].replace(/_/g, '.');
          }
          break;

        case 'iOS':
          const iosMatch = ua.match(/os ([0-9_]+)/i);
          if (iosMatch) {
            return iosMatch[1].replace(/_/g, '.');
          }
          break;

        case 'Android':
          const androidMatch = ua.match(/android ([0-9.]+)/i);
          if (androidMatch) {
            return androidMatch[1];
          }
          break;
      }
    } catch (error) {
      this.logger.warn(`Error detecting OS version: ${error.message}`);
    }

    return 'Unknown';
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
    return 'Unknown';
  }

  /**
   * Detect browser version from user agent
   */
  private detectBrowserVersion(ua: string, browser: string): string {
    try {
      let match: RegExpMatchArray | null = null;

      switch (browser) {
        case 'Chrome':
          match = ua.match(/chrome\/([0-9.]+)/i);
          break;
        case 'Firefox':
          match = ua.match(/firefox\/([0-9.]+)/i);
          break;
        case 'Safari':
          match = ua.match(/version\/([0-9.]+)/i);
          break;
        case 'Edge':
          match = ua.match(/edg\/([0-9.]+)/i);
          break;
        case 'Opera':
          match = ua.match(/(?:opera|opr)\/([0-9.]+)/i);
          break;
        case 'Internet Explorer':
          match = ua.match(/(?:msie |rv:)([0-9.]+)/i);
          break;
      }

      return match ? match[1] : 'Unknown';
    } catch (error) {
      this.logger.warn(`Error detecting browser version: ${error.message}`);
      return 'Unknown';
    }
  }

  /**
   * Get default device info for cases where user agent is not available
   */
  private getDefaultDeviceInfo(): DeviceInfo {
    return {
      type: 'desktop',
      os: 'Unknown',
      osVersion: 'Unknown',
      browser: 'Unknown',
      browserVersion: 'Unknown',
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isIOS: false,
      isAndroid: false,
      isBot: false,
    };
  }

  /**
   * Get device statistics for analytics
   */
  getDeviceStats(userAgents: string[]): {
    deviceTypes: { [key: string]: number };
    operatingSystems: { [key: string]: number };
    browsers: { [key: string]: number };
    mobileVsDesktop: { mobile: number; desktop: number };
  } {
    const stats = {
      deviceTypes: {} as { [key: string]: number },
      operatingSystems: {} as { [key: string]: number },
      browsers: {} as { [key: string]: number },
      mobileVsDesktop: { mobile: 0, desktop: 0 },
    };

    userAgents.forEach(ua => {
      const deviceInfo = this.parseUserAgent(ua);

      // Device types
      stats.deviceTypes[deviceInfo.type] = (stats.deviceTypes[deviceInfo.type] || 0) + 1;

      // Operating systems
      stats.operatingSystems[deviceInfo.os] = (stats.operatingSystems[deviceInfo.os] || 0) + 1;

      // Browsers
      stats.browsers[deviceInfo.browser] = (stats.browsers[deviceInfo.browser] || 0) + 1;

      // Mobile vs Desktop
      if (deviceInfo.isMobile || deviceInfo.isTablet) {
        stats.mobileVsDesktop.mobile++;
      } else {
        stats.mobileVsDesktop.desktop++;
      }
    });

    return stats;
  }

  /**
   * Validate device-specific URLs
   */
  validateDeviceUrls(iosUrl?: string, androidUrl?: string): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (iosUrl) {
      try {
        new URL(iosUrl);
      } catch {
        errors.push('Invalid iOS URL format');
      }
    }

    if (androidUrl) {
      try {
        new URL(androidUrl);
      } catch {
        errors.push('Invalid Android URL format');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}