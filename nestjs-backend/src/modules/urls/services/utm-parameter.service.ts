import { Injectable, Logger } from '@nestjs/common';

export interface UTMParameters {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export interface UTMValidationResult {
  isValid: boolean;
  errors: string[];
  sanitized?: UTMParameters;
}

@Injectable()
export class UTMParameterService {
  private readonly logger = new Logger(UTMParameterService.name);

  /**
   * Extract UTM parameters from a URL
   */
  extractUTMParameters(url: string): UTMParameters {
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;

      return {
        utm_source: params.get('utm_source') || undefined,
        utm_medium: params.get('utm_medium') || undefined,
        utm_campaign: params.get('utm_campaign') || undefined,
        utm_term: params.get('utm_term') || undefined,
        utm_content: params.get('utm_content') || undefined,
      };
    } catch (error) {
      this.logger.warn(`Error extracting UTM parameters from URL: ${url}`, error);
      return {};
    }
  }

  /**
   * Append UTM parameters to a URL
   */
  appendUTMParameters(url: string, utmParams: UTMParameters): string {
    try {
      const urlObj = new URL(url);

      // Add UTM parameters to the URL
      Object.entries(utmParams).forEach(([key, value]) => {
        if (value && value.trim()) {
          urlObj.searchParams.set(key, value.trim());
        }
      });

      return urlObj.toString();
    } catch (error) {
      this.logger.error(`Error appending UTM parameters to URL: ${url}`, error);
      return url; // Return original URL if there's an error
    }
  }

  /**
   * Merge UTM parameters from link configuration and referrer
   */
  mergeUTMParameters(
    linkUTMParams: UTMParameters,
    referrerUTMParams: UTMParameters,
  ): UTMParameters {
    // Link UTM parameters take precedence over referrer UTM parameters
    return {
      utm_source: linkUTMParams.utm_source || referrerUTMParams.utm_source,
      utm_medium: linkUTMParams.utm_medium || referrerUTMParams.utm_medium,
      utm_campaign: linkUTMParams.utm_campaign || referrerUTMParams.utm_campaign,
      utm_term: linkUTMParams.utm_term || referrerUTMParams.utm_term,
      utm_content: linkUTMParams.utm_content || referrerUTMParams.utm_content,
    };
  }

  /**
   * Build final redirect URL with UTM parameters
   */
  buildRedirectUrlWithUTM(
    originalUrl: string,
    linkUTMParams: UTMParameters,
    referrerUrl?: string,
  ): string {
    // Extract UTM parameters from referrer if available
    const referrerUTMParams = referrerUrl 
      ? this.extractUTMParameters(referrerUrl)
      : {};

    // Merge UTM parameters
    const finalUTMParams = this.mergeUTMParameters(linkUTMParams, referrerUTMParams);

    // Filter out empty parameters
    const filteredUTMParams = this.filterEmptyParameters(finalUTMParams);

    // If no UTM parameters, return original URL
    if (Object.keys(filteredUTMParams).length === 0) {
      return originalUrl;
    }

    // Append UTM parameters to the original URL
    return this.appendUTMParameters(originalUrl, filteredUTMParams);
  }

  /**
   * Validate UTM parameters
   */
  validateUTMParameters(utmParams: UTMParameters): UTMValidationResult {
    const errors: string[] = [];
    const sanitized: UTMParameters = {};

    // Validate and sanitize each parameter
    Object.entries(utmParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        const sanitizedValue = this.sanitizeUTMParameter(value);
        
        if (sanitizedValue.length === 0) {
          errors.push(`${key} cannot be empty`);
        } else if (sanitizedValue.length > 100) {
          errors.push(`${key} must be less than 100 characters`);
        } else {
          sanitized[key as keyof UTMParameters] = sanitizedValue;
        }
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      sanitized: errors.length === 0 ? sanitized : undefined,
    };
  }

  /**
   * Sanitize UTM parameter value
   */
  private sanitizeUTMParameter(value: string): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value
      .trim()
      .replace(/[<>\"']/g, '') // Remove potentially dangerous characters
      .substring(0, 100); // Limit length
  }

  /**
   * Filter out empty UTM parameters
   */
  private filterEmptyParameters(utmParams: UTMParameters): UTMParameters {
    const filtered: UTMParameters = {};

    Object.entries(utmParams).forEach(([key, value]) => {
      if (value && value.trim()) {
        filtered[key as keyof UTMParameters] = value.trim();
      }
    });

    return filtered;
  }

  /**
   * Generate UTM parameters for common campaign types
   */
  generateCampaignUTM(
    source: string,
    medium: string,
    campaignName: string,
    options?: {
      term?: string;
      content?: string;
    },
  ): UTMParameters {
    return {
      utm_source: source,
      utm_medium: medium,
      utm_campaign: campaignName,
      utm_term: options?.term,
      utm_content: options?.content,
    };
  }

  /**
   * Get UTM parameter suggestions for common sources
   */
  getUTMSuggestions(): {
    sources: string[];
    mediums: string[];
    campaigns: string[];
  } {
    return {
      sources: [
        'google',
        'facebook',
        'twitter',
        'linkedin',
        'instagram',
        'youtube',
        'tiktok',
        'pinterest',
        'reddit',
        'newsletter',
        'email',
        'blog',
        'website',
        'direct',
      ],
      mediums: [
        'cpc',
        'cpm',
        'social',
        'email',
        'organic',
        'referral',
        'display',
        'video',
        'affiliate',
        'direct',
        'push',
        'sms',
      ],
      campaigns: [
        'brand_awareness',
        'lead_generation',
        'conversion',
        'retargeting',
        'product_launch',
        'seasonal_sale',
        'newsletter',
        'webinar',
        'content_promotion',
        'app_install',
      ],
    };
  }

  /**
   * Parse UTM parameters from query string
   */
  parseUTMFromQueryString(queryString: string): UTMParameters {
    const params = new URLSearchParams(queryString);
    
    return {
      utm_source: params.get('utm_source') || undefined,
      utm_medium: params.get('utm_medium') || undefined,
      utm_campaign: params.get('utm_campaign') || undefined,
      utm_term: params.get('utm_term') || undefined,
      utm_content: params.get('utm_content') || undefined,
    };
  }

  /**
   * Convert UTM parameters to query string
   */
  utmToQueryString(utmParams: UTMParameters): string {
    const params = new URLSearchParams();

    Object.entries(utmParams).forEach(([key, value]) => {
      if (value && value.trim()) {
        params.set(key, value.trim());
      }
    });

    return params.toString();
  }

  /**
   * Check if URL already has UTM parameters
   */
  hasUTMParameters(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
      
      return utmKeys.some(key => urlObj.searchParams.has(key));
    } catch {
      return false;
    }
  }

  /**
   * Remove UTM parameters from URL
   */
  removeUTMParameters(url: string): string {
    try {
      const urlObj = new URL(url);
      const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
      
      utmKeys.forEach(key => {
        urlObj.searchParams.delete(key);
      });

      return urlObj.toString();
    } catch (error) {
      this.logger.warn(`Error removing UTM parameters from URL: ${url}`, error);
      return url;
    }
  }

  /**
   * Get UTM analytics data structure
   */
  getUTMAnalyticsStructure(utmParams: UTMParameters): {
    source: string;
    medium: string;
    campaign: string;
    term: string;
    content: string;
  } {
    return {
      source: utmParams.utm_source || 'direct',
      medium: utmParams.utm_medium || 'none',
      campaign: utmParams.utm_campaign || '(not set)',
      term: utmParams.utm_term || '(not set)',
      content: utmParams.utm_content || '(not set)',
    };
  }
}