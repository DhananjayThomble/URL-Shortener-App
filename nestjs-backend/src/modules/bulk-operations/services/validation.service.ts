import { Injectable } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { CsvLinkRecord } from '../dto/bulk-import.dto';
import { BulkOperationError } from '../schemas/bulk-operation.schema';

@Injectable()
export class ValidationService {
  /**
   * Validate CSV headers against expected format
   */
  validateCsvHeaders(headers: string[]): BulkOperationError[] {
    const errors: BulkOperationError[] = [];
    const requiredHeaders = ['originalUrl'];
    const validHeaders = [
      'originalUrl', 'shortCode', 'customAlias', 'title', 'isActive',
      'expiresAt', 'password', 'passwordHint', 'iosUrl', 'androidUrl',
      'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent',
      'metaPixelId', 'googleAnalyticsId', 'tiktokPixelId', 'tags', 'geoRules'
    ];

    // Check for required headers
    for (const required of requiredHeaders) {
      if (!headers.includes(required)) {
        errors.push({
          field: 'headers',
          message: `Required header '${required}' is missing`,
        });
      }
    }

    // Check for invalid headers
    for (const header of headers) {
      if (!validHeaders.includes(header)) {
        errors.push({
          field: 'headers',
          message: `Invalid header '${header}'. Valid headers are: ${validHeaders.join(', ')}`,
        });
      }
    }

    return errors;
  }

  /**
   * Validate a single CSV record
   */
  async validateCsvRecord(record: CsvLinkRecord, rowNumber: number): Promise<BulkOperationError[]> {
    const errors: BulkOperationError[] = [];

    // Validate required fields
    if (!record.originalUrl || record.originalUrl.trim() === '') {
      errors.push({
        row: rowNumber,
        field: 'originalUrl',
        message: 'Original URL is required',
        value: record.originalUrl,
      });
    }

    // Validate URL format
    if (record.originalUrl && !this.isValidUrl(record.originalUrl)) {
      errors.push({
        row: rowNumber,
        field: 'originalUrl',
        message: 'Invalid URL format',
        value: record.originalUrl,
      });
    }

    // Validate optional URLs
    if (record.iosUrl && !this.isValidUrl(record.iosUrl)) {
      errors.push({
        row: rowNumber,
        field: 'iosUrl',
        message: 'Invalid iOS URL format',
        value: record.iosUrl,
      });
    }

    if (record.androidUrl && !this.isValidUrl(record.androidUrl)) {
      errors.push({
        row: rowNumber,
        field: 'androidUrl',
        message: 'Invalid Android URL format',
        value: record.androidUrl,
      });
    }

    // Validate short code format
    if (record.shortCode && !this.isValidShortCode(record.shortCode)) {
      errors.push({
        row: rowNumber,
        field: 'shortCode',
        message: 'Short code must be 3-10 characters, alphanumeric only',
        value: record.shortCode,
      });
    }

    // Validate custom alias format
    if (record.customAlias && !this.isValidCustomAlias(record.customAlias)) {
      errors.push({
        row: rowNumber,
        field: 'customAlias',
        message: 'Custom alias must be 3-50 characters, alphanumeric and hyphens only',
        value: record.customAlias,
      });
    }

    // Validate expiration date
    if (record.expiresAt && !this.isValidDate(record.expiresAt)) {
      errors.push({
        row: rowNumber,
        field: 'expiresAt',
        message: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)',
        value: record.expiresAt,
      });
    }

    // Validate boolean fields
    if (record.isActive !== undefined && !this.isValidBoolean(record.isActive)) {
      errors.push({
        row: rowNumber,
        field: 'isActive',
        message: 'isActive must be true, false, 1, or 0',
        value: record.isActive,
      });
    }

    // Validate geo rules JSON
    if (record.geoRules && !this.isValidJson(record.geoRules)) {
      errors.push({
        row: rowNumber,
        field: 'geoRules',
        message: 'Invalid JSON format for geo rules',
        value: record.geoRules,
      });
    }

    // Validate UTM parameters length
    const utmFields = ['utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent'];
    for (const field of utmFields) {
      const value = record[field as keyof CsvLinkRecord] as string;
      if (value && value.length > 100) {
        errors.push({
          row: rowNumber,
          field,
          message: `${field} must be 100 characters or less`,
          value,
        });
      }
    }

    // Validate pixel IDs length
    const pixelFields = ['metaPixelId', 'googleAnalyticsId', 'tiktokPixelId'];
    for (const field of pixelFields) {
      const value = record[field as keyof CsvLinkRecord] as string;
      if (value && value.length > 50) {
        errors.push({
          row: rowNumber,
          field,
          message: `${field} must be 50 characters or less`,
          value,
        });
      }
    }

    return errors;
  }

  /**
   * Validate file format and size
   */
  validateFile(file: any): BulkOperationError[] {
    const errors: BulkOperationError[] = [];
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedMimeTypes = ['text/csv', 'application/csv', 'text/plain'];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      errors.push({
        field: 'file',
        message: 'Invalid file type. Only CSV files are allowed',
        value: file.mimetype,
      });
    }

    if (file.size > maxSize) {
      errors.push({
        field: 'file',
        message: `File size exceeds maximum limit of ${maxSize / 1024 / 1024}MB`,
        value: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
      });
    }

    return errors;
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private isValidShortCode(shortCode: string): boolean {
    return /^[a-zA-Z0-9]{3,10}$/.test(shortCode);
  }

  private isValidCustomAlias(alias: string): boolean {
    return /^[a-zA-Z0-9-]{3,50}$/.test(alias);
  }

  private isValidDate(dateString: string): boolean {
    const date = new Date(dateString);
    return !isNaN(date.getTime()) && date > new Date();
  }

  private isValidBoolean(value: any): boolean {
    return value === true || value === false || value === '1' || value === '0' || 
           value === 'true' || value === 'false';
  }

  private isValidJson(jsonString: string): boolean {
    try {
      JSON.parse(jsonString);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Convert string boolean values to actual booleans
   */
  normalizeBoolean(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true' || value === '1';
    }
    return Boolean(value);
  }

  /**
   * Parse and validate geo rules JSON
   */
  parseGeoRules(geoRulesString: string): any[] {
    try {
      const rules = JSON.parse(geoRulesString);
      if (!Array.isArray(rules)) {
        throw new Error('Geo rules must be an array');
      }
      
      for (const rule of rules) {
        if (!rule.countryCode || !rule.redirectUrl) {
          throw new Error('Each geo rule must have countryCode and redirectUrl');
        }
        if (!/^[A-Z]{2}$/.test(rule.countryCode)) {
          throw new Error('Country code must be 2 uppercase letters');
        }
        if (!this.isValidUrl(rule.redirectUrl)) {
          throw new Error('Invalid redirect URL in geo rule');
        }
      }
      
      return rules;
    } catch (error) {
      throw new Error(`Invalid geo rules: ${error.message}`);
    }
  }
}