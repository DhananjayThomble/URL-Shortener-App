import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface SecretConfig {
  name: string;
  value: string;
  encrypted?: boolean;
  required?: boolean;
  minLength?: number;
  pattern?: RegExp;
}

@Injectable()
export class SecretsManagementService {
  private readonly logger = new Logger(SecretsManagementService.name);
  private readonly encryptionKey: string;
  private readonly algorithm = 'aes-256-gcm';

  constructor(private configService: ConfigService) {
    // Use a master key for encryption (should be stored securely in production)
    this.encryptionKey = this.configService.get<string>('MASTER_ENCRYPTION_KEY') || 
                        this.generateMasterKey();
  }

  /**
   * Generate a master encryption key
   */
  private generateMasterKey(): string {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    
    if (nodeEnv === 'production') {
      throw new Error('MASTER_ENCRYPTION_KEY must be provided in production environment');
    }
    
    // Generate a key for development/test environments
    const key = crypto.randomBytes(32).toString('hex');
    this.logger.warn(`Generated temporary encryption key for ${nodeEnv} environment`);
    return key;
  }

  /**
   * Encrypt a secret value
   */
  encryptSecret(plaintext: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher(this.algorithm, this.encryptionKey);
      cipher.setAAD(Buffer.from('secret-data'));
      
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      this.logger.error('Failed to encrypt secret:', error.message);
      throw new Error('Secret encryption failed');
    }
  }

  /**
   * Decrypt a secret value
   */
  decryptSecret(encryptedData: string): string {
    try {
      const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
      
      if (!ivHex || !authTagHex || !encrypted) {
        throw new Error('Invalid encrypted data format');
      }
      
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey);
      decipher.setAAD(Buffer.from('secret-data'));
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      this.logger.error('Failed to decrypt secret:', error.message);
      throw new Error('Secret decryption failed');
    }
  }

  /**
   * Validate secret configuration
   */
  validateSecret(config: SecretConfig): boolean {
    const { name, value, required = true, minLength = 8, pattern } = config;
    
    // Check if required secret is present
    if (required && !value) {
      this.logger.error(`Required secret '${name}' is missing`);
      return false;
    }
    
    // Skip validation if secret is not provided and not required
    if (!value && !required) {
      return true;
    }
    
    // Check minimum length
    if (value.length < minLength) {
      this.logger.error(`Secret '${name}' is too short (minimum ${minLength} characters)`);
      return false;
    }
    
    // Check pattern if provided
    if (pattern && !pattern.test(value)) {
      this.logger.error(`Secret '${name}' does not match required pattern`);
      return false;
    }
    
    return true;
  }

  /**
   * Validate all application secrets
   */
  validateApplicationSecrets(): boolean {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const isProduction = nodeEnv === 'production';
    
    const secrets: SecretConfig[] = [
      {
        name: 'JWT_SECRET',
        value: this.configService.get<string>('JWT_SECRET'),
        required: true,
        minLength: isProduction ? 32 : 16,
        pattern: isProduction ? /^(?!.*dev|.*test|.*CHANGE_ME).*$/ : undefined,
      },
      {
        name: 'JWT_REFRESH_SECRET',
        value: this.configService.get<string>('JWT_REFRESH_SECRET'),
        required: true,
        minLength: isProduction ? 32 : 16,
        pattern: isProduction ? /^(?!.*dev|.*test|.*CHANGE_ME).*$/ : undefined,
      },
      {
        name: 'SESSION_SECRET',
        value: this.configService.get<string>('SESSION_SECRET'),
        required: true,
        minLength: isProduction ? 32 : 16,
        pattern: isProduction ? /^(?!.*dev|.*test|.*CHANGE_ME).*$/ : undefined,
      },
      {
        name: 'DATABASE_PASSWORD',
        value: this.configService.get<string>('DATABASE_PASSWORD'),
        required: true,
        minLength: 8,
      },
      {
        name: 'REDIS_PASSWORD',
        value: this.configService.get<string>('REDIS_PASSWORD'),
        required: false,
        minLength: 8,
      },
      {
        name: 'SMTP_PASS',
        value: this.configService.get<string>('SMTP_PASS'),
        required: false,
        minLength: 8,
      },
      {
        name: 'AWS_SECRET_ACCESS_KEY',
        value: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
        required: false,
        minLength: 20,
      },
    ];

    let allValid = true;
    
    for (const secret of secrets) {
      if (!this.validateSecret(secret)) {
        allValid = false;
      }
    }
    
    if (allValid) {
      this.logger.log('All application secrets validated successfully');
    } else {
      this.logger.error('Secret validation failed - check configuration');
    }
    
    return allValid;
  }

  /**
   * Generate a secure random secret
   */
  generateSecureSecret(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate JWT secret pair
   */
  generateJwtSecrets(): { jwtSecret: string; refreshSecret: string } {
    return {
      jwtSecret: this.generateSecureSecret(32),
      refreshSecret: this.generateSecureSecret(32),
    };
  }

  /**
   * Check if a secret appears to be weak or default
   */
  isWeakSecret(secret: string): boolean {
    const weakPatterns = [
      /password/i,
      /123456/,
      /qwerty/i,
      /admin/i,
      /test/i,
      /dev/i,
      /change.*me/i,
      /secret/i,
      /default/i,
    ];
    
    // Check for common weak patterns
    for (const pattern of weakPatterns) {
      if (pattern.test(secret)) {
        return true;
      }
    }
    
    // Check for insufficient entropy (too repetitive)
    const uniqueChars = new Set(secret.toLowerCase()).size;
    if (uniqueChars < secret.length * 0.5) {
      return true;
    }
    
    return false;
  }

  /**
   * Audit all secrets for security issues
   */
  auditSecrets(): {
    passed: string[];
    failed: string[];
    warnings: string[];
  } {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const isProduction = nodeEnv === 'production';
    
    const secretKeys = [
      'JWT_SECRET',
      'JWT_REFRESH_SECRET', 
      'SESSION_SECRET',
      'DATABASE_PASSWORD',
      'REDIS_PASSWORD',
      'SMTP_PASS',
    ];
    
    const results = {
      passed: [] as string[],
      failed: [] as string[],
      warnings: [] as string[],
    };
    
    for (const key of secretKeys) {
      const value = this.configService.get<string>(key);
      
      if (!value) {
        if (key.includes('REDIS_PASSWORD') || key.includes('SMTP_PASS')) {
          results.warnings.push(`${key}: Optional secret not configured`);
        } else {
          results.failed.push(`${key}: Required secret missing`);
        }
        continue;
      }
      
      // Check for weak secrets
      if (this.isWeakSecret(value)) {
        if (isProduction) {
          results.failed.push(`${key}: Weak secret detected in production`);
        } else {
          results.warnings.push(`${key}: Weak secret (acceptable in ${nodeEnv})`);
        }
        continue;
      }
      
      // Check minimum length for production
      if (isProduction && value.length < 32) {
        results.failed.push(`${key}: Too short for production (minimum 32 characters)`);
        continue;
      }
      
      results.passed.push(`${key}: Valid`);
    }
    
    return results;
  }

  /**
   * Log secrets audit results
   */
  logSecretsAudit(): void {
    const audit = this.auditSecrets();
    
    this.logger.log('=== Secrets Security Audit ===');
    
    if (audit.passed.length > 0) {
      this.logger.log('✅ Passed:');
      audit.passed.forEach(item => this.logger.log(`  ${item}`));
    }
    
    if (audit.warnings.length > 0) {
      this.logger.warn('⚠️  Warnings:');
      audit.warnings.forEach(item => this.logger.warn(`  ${item}`));
    }
    
    if (audit.failed.length > 0) {
      this.logger.error('❌ Failed:');
      audit.failed.forEach(item => this.logger.error(`  ${item}`));
    }
    
    this.logger.log('=== End Secrets Audit ===');
    
    // Throw error if any critical failures in production
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (nodeEnv === 'production' && audit.failed.length > 0) {
      throw new Error('Critical security issues found in production secrets');
    }
  }

  /**
   * Rotate secrets (generate new ones)
   */
  rotateSecrets(): { [key: string]: string } {
    this.logger.log('Generating new secrets for rotation...');
    
    const newSecrets = {
      JWT_SECRET: this.generateSecureSecret(32),
      JWT_REFRESH_SECRET: this.generateSecureSecret(32),
      SESSION_SECRET: this.generateSecureSecret(32),
    };
    
    this.logger.log('New secrets generated. Update your environment configuration.');
    
    return newSecrets;
  }
}