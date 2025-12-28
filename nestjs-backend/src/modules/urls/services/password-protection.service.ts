import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { LinkRepository } from '../repositories/link.repository';
import { Link } from '../entities/link.entity';

export interface PasswordProtectionOptions {
  password: string;
  hint?: string;
}

export interface PasswordValidationResult {
  isValid: boolean;
  requiresPassword: boolean;
  hint?: string;
}

@Injectable()
export class PasswordProtectionService {
  private readonly logger = new Logger(PasswordProtectionService.name);
  private readonly saltRounds = 12;

  constructor(private readonly linkRepository: LinkRepository) {}

  /**
   * Hash a password using bcrypt with salt
   */
  async hashPassword(password: string): Promise<string> {
    if (!password || password.length < 4) {
      throw new BadRequestException('Password must be at least 4 characters long');
    }

    if (password.length > 128) {
      throw new BadRequestException('Password must be less than 128 characters');
    }

    try {
      return await bcrypt.hash(password, this.saltRounds);
    } catch (error) {
      this.logger.error('Error hashing password:', error);
      throw new BadRequestException('Failed to hash password');
    }
  }

  /**
   * Verify a password against a hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    if (!password || !hash) {
      return false;
    }

    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      this.logger.error('Error verifying password:', error);
      return false;
    }
  }

  /**
   * Set password protection for a link
   */
  async setLinkPassword(
    linkId: string,
    userId: string,
    options: PasswordProtectionOptions,
  ): Promise<Link> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new BadRequestException('Link not found or access denied');
    }

    const passwordHash = await this.hashPassword(options.password);

    const updatedLink = await this.linkRepository.update(linkId, {
      passwordHash,
      passwordHint: options.hint || null,
    });

    this.logger.log(`Password protection set for link ${linkId}`);
    return updatedLink;
  }

  /**
   * Remove password protection from a link
   */
  async removeLinkPassword(linkId: string, userId: string): Promise<Link> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new BadRequestException('Link not found or access denied');
    }

    const updatedLink = await this.linkRepository.update(linkId, {
      passwordHash: null,
      passwordHint: null,
    });

    this.logger.log(`Password protection removed from link ${linkId}`);
    return updatedLink;
  }

  /**
   * Validate password for a link access
   */
  async validateLinkPassword(
    shortCode: string,
    password?: string,
  ): Promise<PasswordValidationResult> {
    const link = await this.linkRepository.findByShortCode(shortCode);
    
    if (!link) {
      throw new BadRequestException('Link not found');
    }

    // If link has no password protection
    if (!link.passwordHash) {
      return {
        isValid: true,
        requiresPassword: false,
      };
    }

    // If password is required but not provided
    if (!password) {
      return {
        isValid: false,
        requiresPassword: true,
        hint: link.passwordHint,
      };
    }

    // Verify the provided password
    const isValid = await this.verifyPassword(password, link.passwordHash);
    
    if (!isValid) {
      this.logger.warn(`Invalid password attempt for link ${shortCode}`);
    }

    return {
      isValid,
      requiresPassword: true,
      hint: isValid ? undefined : link.passwordHint,
    };
  }

  /**
   * Check if a link requires password
   */
  async isPasswordProtected(shortCode: string): Promise<boolean> {
    const link = await this.linkRepository.findByShortCode(shortCode);
    return !!(link?.passwordHash);
  }

  /**
   * Get password hint for a link
   */
  async getPasswordHint(shortCode: string): Promise<string | null> {
    const link = await this.linkRepository.findByShortCode(shortCode);
    return link?.passwordHint || null;
  }

  /**
   * Update password hint for a link
   */
  async updatePasswordHint(
    linkId: string,
    userId: string,
    hint: string,
  ): Promise<Link> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new BadRequestException('Link not found or access denied');
    }

    if (!link.passwordHash) {
      throw new BadRequestException('Link is not password protected');
    }

    const updatedLink = await this.linkRepository.update(linkId, {
      passwordHint: hint,
    });

    this.logger.log(`Password hint updated for link ${linkId}`);
    return updatedLink;
  }

  /**
   * Change password for a link
   */
  async changeLinkPassword(
    linkId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
    hint?: string,
  ): Promise<Link> {
    const link = await this.linkRepository.findById(linkId);
    
    if (!link || link.userId !== userId) {
      throw new BadRequestException('Link not found or access denied');
    }

    if (!link.passwordHash) {
      throw new BadRequestException('Link is not password protected');
    }

    // Verify current password
    const isCurrentPasswordValid = await this.verifyPassword(
      currentPassword,
      link.passwordHash,
    );

    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await this.hashPassword(newPassword);

    const updatedLink = await this.linkRepository.update(linkId, {
      passwordHash: newPasswordHash,
      passwordHint: hint !== undefined ? hint : link.passwordHint,
    });

    this.logger.log(`Password changed for link ${linkId}`);
    return updatedLink;
  }

  /**
   * Validate password strength
   */
  validatePasswordStrength(password: string): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (password.length < 4) {
      errors.push('Password must be at least 4 characters long');
    }

    if (password.length > 128) {
      errors.push('Password must be less than 128 characters');
    }

    // Check for common weak passwords
    const commonPasswords = [
      'password', '123456', '12345678', 'qwerty', 'abc123',
      'password123', 'admin', 'letmein', 'welcome', 'monkey',
    ];

    if (commonPasswords.includes(password.toLowerCase())) {
      errors.push('Password is too common, please choose a stronger password');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}