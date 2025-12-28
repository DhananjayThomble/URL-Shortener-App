import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface GeolocationData {
  country: string;
  countryCode: string;
  region: string;
  regionName: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  timezone: string;
  isp: string;
  org: string;
  as: string;
}

export interface GeolocationResult {
  success: boolean;
  data?: GeolocationData;
  error?: string;
}

@Injectable()
export class IpGeolocationService {
  private readonly logger = new Logger(IpGeolocationService.name);
  private readonly cache = new Map<string, GeolocationData>();
  private readonly cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours

  constructor(private readonly configService: ConfigService) {}

  /**
   * Get geolocation data for an IP address
   */
  async getGeolocation(ipAddress: string): Promise<GeolocationResult> {
    try {
      // Check cache first
      const cached = this.getCachedGeolocation(ipAddress);
      if (cached) {
        return { success: true, data: cached };
      }

      // Handle localhost and private IPs
      if (this.isPrivateOrLocalhost(ipAddress)) {
        const defaultData: GeolocationData = {
          country: 'Unknown',
          countryCode: 'XX',
          region: 'Unknown',
          regionName: 'Unknown',
          city: 'Unknown',
          zip: 'Unknown',
          lat: 0,
          lon: 0,
          timezone: 'Unknown',
          isp: 'Unknown',
          org: 'Unknown',
          as: 'Unknown',
        };
        return { success: true, data: defaultData };
      }

      // Try multiple geolocation services
      const result = await this.tryGeolocationServices(ipAddress);
      
      if (result.success && result.data) {
        this.setCachedGeolocation(ipAddress, result.data);
      }

      return result;
    } catch (error) {
      this.logger.error(`Error getting geolocation for IP ${ipAddress}:`, error);
      return {
        success: false,
        error: 'Failed to get geolocation data',
      };
    }
  }

  /**
   * Get country code from IP address
   */
  async getCountryCode(ipAddress: string): Promise<string> {
    const result = await this.getGeolocation(ipAddress);
    return result.data?.countryCode || 'XX';
  }

  /**
   * Get country name from IP address
   */
  async getCountryName(ipAddress: string): Promise<string> {
    const result = await this.getGeolocation(ipAddress);
    return result.data?.country || 'Unknown';
  }

  /**
   * Check if IP is valid for geolocation
   */
  isValidPublicIp(ipAddress: string): boolean {
    if (!ipAddress || this.isPrivateOrLocalhost(ipAddress)) {
      return false;
    }

    // Basic IP validation
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    
    return ipv4Regex.test(ipAddress) || ipv6Regex.test(ipAddress);
  }

  private async tryGeolocationServices(ipAddress: string): Promise<GeolocationResult> {
    // Try ip-api.com first (free, no API key required)
    try {
      const result = await this.getFromIpApi(ipAddress);
      if (result.success) {
        return result;
      }
    } catch (error) {
      this.logger.warn('ip-api.com failed, trying next service');
    }

    // Try ipapi.co as fallback
    try {
      const result = await this.getFromIpApiCo(ipAddress);
      if (result.success) {
        return result;
      }
    } catch (error) {
      this.logger.warn('ipapi.co failed, trying next service');
    }

    // Try ipinfo.io as last resort
    try {
      const result = await this.getFromIpInfo(ipAddress);
      if (result.success) {
        return result;
      }
    } catch (error) {
      this.logger.warn('ipinfo.io failed');
    }

    return {
      success: false,
      error: 'All geolocation services failed',
    };
  }

  private async getFromIpApi(ipAddress: string): Promise<GeolocationResult> {
    const response = await axios.get(
      `http://ip-api.com/json/${ipAddress}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as`,
      { timeout: 5000 }
    );

    if (response.data.status === 'success') {
      return {
        success: true,
        data: {
          country: response.data.country || 'Unknown',
          countryCode: response.data.countryCode || 'XX',
          region: response.data.region || 'Unknown',
          regionName: response.data.regionName || 'Unknown',
          city: response.data.city || 'Unknown',
          zip: response.data.zip || 'Unknown',
          lat: response.data.lat || 0,
          lon: response.data.lon || 0,
          timezone: response.data.timezone || 'Unknown',
          isp: response.data.isp || 'Unknown',
          org: response.data.org || 'Unknown',
          as: response.data.as || 'Unknown',
        },
      };
    }

    return {
      success: false,
      error: response.data.message || 'Unknown error',
    };
  }

  private async getFromIpApiCo(ipAddress: string): Promise<GeolocationResult> {
    const response = await axios.get(
      `https://ipapi.co/${ipAddress}/json/`,
      { timeout: 5000 }
    );

    if (response.data && !response.data.error) {
      return {
        success: true,
        data: {
          country: response.data.country_name || 'Unknown',
          countryCode: response.data.country_code || 'XX',
          region: response.data.region_code || 'Unknown',
          regionName: response.data.region || 'Unknown',
          city: response.data.city || 'Unknown',
          zip: response.data.postal || 'Unknown',
          lat: response.data.latitude || 0,
          lon: response.data.longitude || 0,
          timezone: response.data.timezone || 'Unknown',
          isp: response.data.org || 'Unknown',
          org: response.data.org || 'Unknown',
          as: response.data.asn || 'Unknown',
        },
      };
    }

    return {
      success: false,
      error: response.data.reason || 'Unknown error',
    };
  }

  private async getFromIpInfo(ipAddress: string): Promise<GeolocationResult> {
    const token = this.configService.get<string>('IPINFO_TOKEN');
    const url = token 
      ? `https://ipinfo.io/${ipAddress}?token=${token}`
      : `https://ipinfo.io/${ipAddress}`;

    const response = await axios.get(url, { timeout: 5000 });

    if (response.data && !response.data.error) {
      const [lat, lon] = (response.data.loc || '0,0').split(',').map(Number);
      
      return {
        success: true,
        data: {
          country: response.data.country || 'Unknown',
          countryCode: response.data.country || 'XX',
          region: response.data.region || 'Unknown',
          regionName: response.data.region || 'Unknown',
          city: response.data.city || 'Unknown',
          zip: response.data.postal || 'Unknown',
          lat: lat || 0,
          lon: lon || 0,
          timezone: response.data.timezone || 'Unknown',
          isp: response.data.org || 'Unknown',
          org: response.data.org || 'Unknown',
          as: response.data.org || 'Unknown',
        },
      };
    }

    return {
      success: false,
      error: 'Unknown error',
    };
  }

  private isPrivateOrLocalhost(ipAddress: string): boolean {
    if (!ipAddress) return true;
    
    // Localhost
    if (ipAddress === '127.0.0.1' || ipAddress === '::1' || ipAddress === 'localhost') {
      return true;
    }

    // Private IP ranges
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./, // Link-local
      /^fc00:/, // IPv6 private
      /^fe80:/, // IPv6 link-local
    ];

    return privateRanges.some(range => range.test(ipAddress));
  }

  private getCachedGeolocation(ipAddress: string): GeolocationData | null {
    const cached = this.cache.get(ipAddress);
    if (cached) {
      return cached;
    }
    return null;
  }

  private setCachedGeolocation(ipAddress: string, data: GeolocationData): void {
    this.cache.set(ipAddress, data);
    
    // Clean up cache periodically
    setTimeout(() => {
      this.cache.delete(ipAddress);
    }, this.cacheExpiry);
  }

  /**
   * Clear geolocation cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Geolocation cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxAge: number } {
    return {
      size: this.cache.size,
      maxAge: this.cacheExpiry,
    };
  }
}