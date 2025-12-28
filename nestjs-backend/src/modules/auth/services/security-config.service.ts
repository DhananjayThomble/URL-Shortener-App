import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SecurityConfig {
  // Password policies
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireNumbers: boolean;
  passwordRequireSymbols: boolean;
  passwordMaxAge: number; // days

  // Session management
  sessionTimeout: number; // minutes
  maxConcurrentSessions: number;
  sessionSecureCookies: boolean;

  // Rate limiting
  rateLimitEnabled: boolean;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;

  // Account security
  maxLoginAttempts: number;
  accountLockoutDuration: number; // minutes
  requireEmailVerification: boolean;
  twoFactorAuthEnabled: boolean;

  // Security headers
  enableHSTS: boolean;
  enableCSP: boolean;
  enableXSSProtection: boolean;
  enableFrameGuard: boolean;

  // Audit logging
  logSecurityEvents: boolean;
  logFailedAttempts: boolean;
  logSuccessfulLogins: boolean;

  // IP restrictions
  allowedIpRanges: string[];
  blockedIpRanges: string[];
  enableGeoBlocking: boolean;
  blockedCountries: string[];
}

@Injectable()
export class SecurityConfigService {
  private readonly logger = new Logger(SecurityConfigService.name);
  private config: SecurityConfig;

  constructor(private readonly configService: ConfigService) {
    this.loadConfiguration();
  }

  private loadConfiguration(): void {
    this.config = {
      // Password policies
      passwordMinLength: this.configService.get('SECURITY_PASSWORD_MIN_LENGTH', 8),
      passwordRequireUppercase: this.configService.get('SECURITY_PASSWORD_REQUIRE_UPPERCASE', 'true') === 'true',
      passwordRequireLowercase: this.configService.get('SECURITY_PASSWORD_REQUIRE_LOWERCASE', 'true') === 'true',
      passwordRequireNumbers: this.configService.get('SECURITY_PASSWORD_REQUIRE_NUMBERS', 'true') === 'true',
      passwordRequireSymbols: this.configService.get('SECURITY_PASSWORD_REQUIRE_SYMBOLS', 'false') === 'true',
      passwordMaxAge: this.configService.get('SECURITY_PASSWORD_MAX_AGE', 90),

      // Session management
      sessionTimeout: this.configService.get('SECURITY_SESSION_TIMEOUT', 30),
      maxConcurrentSessions: this.configService.get('SECURITY_MAX_CONCURRENT_SESSIONS', 5),
      sessionSecureCookies: this.configService.get('NODE_ENV') === 'production',

      // Rate limiting
      rateLimitEnabled: this.configService.get('SECURITY_RATE_LIMIT_ENABLED', 'true') === 'true',
      rateLimitWindowMs: this.configService.get('SECURITY_RATE_LIMIT_WINDOW', 900000),
      rateLimitMaxRequests: this.configService.get('SECURITY_RATE_LIMIT_MAX', 100),

      // Account security
      maxLoginAttempts: this.configService.get('SECURITY_MAX_LOGIN_ATTEMPTS', 5),
      accountLockoutDuration: this.configService.get('SECURITY_LOCKOUT_DURATION', 30),
      requireEmailVerification: this.configService.get('SECURITY_REQUIRE_EMAIL_VERIFICATION', 'true') === 'true',
      twoFactorAuthEnabled: this.configService.get('SECURITY_2FA_ENABLED', 'false') === 'true',

      // Security headers
      enableHSTS: this.configService.get('SECURITY_ENABLE_HSTS', 'true') === 'true',
      enableCSP: this.configService.get('SECURITY_ENABLE_CSP', 'true') === 'true',
      enableXSSProtection: this.configService.get('SECURITY_ENABLE_XSS_PROTECTION', 'true') === 'true',
      enableFrameGuard: this.configService.get('SECURITY_ENABLE_FRAME_GUARD', 'true') === 'true',

      // Audit logging
      logSecurityEvents: this.configService.get('SECURITY_LOG_EVENTS', 'true') === 'true',
      logFailedAttempts: this.configService.get('SECURITY_LOG_FAILED_ATTEMPTS', 'true') === 'true',
      logSuccessfulLogins: this.configService.get('SECURITY_LOG_SUCCESSFUL_LOGINS', 'true') === 'true',

      // IP restrictions
      allowedIpRanges: this.parseIpRanges(this.configService.get('SECURITY_ALLOWED_IP_RANGES', '')),
      blockedIpRanges: this.parseIpRanges(this.configService.get('SECURITY_BLOCKED_IP_RANGES', '')),
      enableGeoBlocking: this.configService.get('SECURITY_ENABLE_GEO_BLOCKING', 'false') === 'true',
      blockedCountries: this.parseCountries(this.configService.get('SECURITY_BLOCKED_COUNTRIES', '')),
    };

    this.logger.log('Security configuration loaded');
  }

  getConfig(): SecurityConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...updates };
    this.logger.log('Security configuration updated');
  }

  validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < this.config.passwordMinLength) {
      errors.push(`Password must be at least ${this.config.passwordMinLength} characters long`);
    }

    if (this.config.passwordRequireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (this.config.passwordRequireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (this.config.passwordRequireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (this.config.passwordRequireSymbols && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    // Check for common weak passwords
    const commonPasswords = [
      'password', '123456', 'password123', 'admin', 'qwerty',
      'letmein', 'welcome', 'monkey', '1234567890', 'password1'
    ];

    if (commonPasswords.includes(password.toLowerCase())) {
      errors.push('Password is too common and easily guessable');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  isIpAllowed(ip: string): boolean {
    // Check blocked ranges first
    if (this.isIpInRanges(ip, this.config.blockedIpRanges)) {
      return false;
    }

    // If allowed ranges are specified, check if IP is in them
    if (this.config.allowedIpRanges.length > 0) {
      return this.isIpInRanges(ip, this.config.allowedIpRanges);
    }

    // If no specific allowed ranges, allow by default (unless blocked)
    return true;
  }

  isCountryBlocked(countryCode: string): boolean {
    if (!this.config.enableGeoBlocking) {
      return false;
    }

    return this.config.blockedCountries.includes(countryCode.toUpperCase());
  }

  getSecurityHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.config.enableHSTS && this.configService.get('NODE_ENV') === 'production') {
      headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
    }

    if (this.config.enableXSSProtection) {
      headers['X-XSS-Protection'] = '1; mode=block';
    }

    if (this.config.enableFrameGuard) {
      headers['X-Frame-Options'] = 'DENY';
    }

    if (this.config.enableCSP) {
      headers['Content-Security-Policy'] = this.generateCSP();
    }

    return headers;
  }

  private parseIpRanges(ranges: string): string[] {
    if (!ranges) return [];
    return ranges.split(',').map(range => range.trim()).filter(range => range.length > 0);
  }

  private parseCountries(countries: string): string[] {
    if (!countries) return [];
    return countries.split(',').map(country => country.trim().toUpperCase()).filter(country => country.length > 0);
  }

  private isIpInRanges(ip: string, ranges: string[]): boolean {
    // Simple IP range checking - in production, use a proper IP range library
    for (const range of ranges) {
      if (range.includes('/')) {
        // CIDR notation - simplified check
        const [network, prefixLength] = range.split('/');
        // This is a simplified implementation - use a proper CIDR library in production
        if (ip.startsWith(network.split('.').slice(0, Math.floor(parseInt(prefixLength) / 8)).join('.'))) {
          return true;
        }
      } else if (range.includes('-')) {
        // Range notation (e.g., 192.168.1.1-192.168.1.100)
        // Simplified implementation
        const [start, end] = range.split('-');
        // This would need proper IP comparison logic
        if (ip >= start && ip <= end) {
          return true;
        }
      } else {
        // Exact match
        if (ip === range) {
          return true;
        }
      }
    }
    return false;
  }

  private generateCSP(): string {
    const directives = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ];

    if (this.configService.get('NODE_ENV') === 'production') {
      directives.push('upgrade-insecure-requests');
    }

    return directives.join('; ');
  }
}