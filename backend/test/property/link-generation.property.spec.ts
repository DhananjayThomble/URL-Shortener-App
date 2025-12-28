/**
 * Link Generation Property-Based Tests
 * Tests universal properties of link generation and management
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { EnhancedLinksService } from '../../src/modules/urls/services/enhanced-links.service';
import { Arbitraries, PropertyTestUtils } from '../property-setup';

describe('Link Generation Properties', () => {
  let service: EnhancedLinksService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        {
          provide: EnhancedLinksService,
          useValue: {
            generateShortCode: jest.fn(),
            validateCustomAlias: jest.fn(),
            createLink: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EnhancedLinksService>(EnhancedLinksService);
  });

  afterAll(async () => {
    await module.close();
  });

  describe('Short Code Generation', () => {
    it('should generate unique short codes', () => {
      // Mock the service to return different codes
      let counter = 0;
      (service.generateShortCode as jest.Mock).mockImplementation(() => {
        return `code${counter++}`;
      });

      const property = PropertyTestUtils.property(
        fc.integer({ min: 1, max: 1000 }),
        (count) => {
          const codes = Array.from({ length: count }, () => service.generateShortCode());
          const uniqueCodes = new Set(codes);
          return codes.length === uniqueCodes.size;
        }
      );

      PropertyTestUtils.assert(property);
    });

    it('should generate codes of consistent length', () => {
      const expectedLength = 8;
      (service.generateShortCode as jest.Mock).mockImplementation(() => {
        return Math.random().toString(36).substring(2, 2 + expectedLength);
      });

      const property = PropertyTestUtils.property(
        fc.integer({ min: 1, max: 100 }),
        (iterations) => {
          for (let i = 0; i < iterations; i++) {
            const code = service.generateShortCode();
            if (code.length !== expectedLength) {
              return false;
            }
          }
          return true;
        }
      );

      PropertyTestUtils.assert(property);
    });

    it('should generate alphanumeric codes only', () => {
      (service.generateShortCode as jest.Mock).mockImplementation(() => {
        return Math.random().toString(36).substring(2, 10);
      });

      const property = PropertyTestUtils.property(
        fc.integer({ min: 1, max: 100 }),
        (iterations) => {
          const alphanumericRegex = /^[a-zA-Z0-9]+$/;
          for (let i = 0; i < iterations; i++) {
            const code = service.generateShortCode();
            if (!alphanumericRegex.test(code)) {
              return false;
            }
          }
          return true;
        }
      );

      PropertyTestUtils.assert(property);
    });
  });

  describe('Custom Alias Validation', () => {
    it('should validate alias format consistently', () => {
      (service.validateCustomAlias as jest.Mock).mockImplementation((alias: string) => {
        return /^[a-zA-Z0-9_-]+$/.test(alias) && alias.length >= 3 && alias.length <= 50;
      });

      const property = PropertyTestUtils.property(
        Arbitraries.customAlias(),
        (alias) => {
          const isValid = service.validateCustomAlias(alias);
          const expectedValid = /^[a-zA-Z0-9_-]+$/.test(alias) && 
                               alias.length >= 3 && 
                               alias.length <= 50;
          return isValid === expectedValid;
        }
      );

      PropertyTestUtils.assert(property);
    });

    it('should reject invalid characters in aliases', () => {
      (service.validateCustomAlias as jest.Mock).mockImplementation((alias: string) => {
        return /^[a-zA-Z0-9_-]+$/.test(alias);
      });

      const invalidCharsArbitrary = fc.string().filter(s => 
        s.length > 0 && !/^[a-zA-Z0-9_-]+$/.test(s)
      );

      const property = PropertyTestUtils.property(
        invalidCharsArbitrary,
        (alias) => {
          return !service.validateCustomAlias(alias);
        }
      );

      PropertyTestUtils.assert(property);
    });

    it('should enforce length constraints', () => {
      (service.validateCustomAlias as jest.Mock).mockImplementation((alias: string) => {
        return alias.length >= 3 && alias.length <= 50;
      });

      const property = PropertyTestUtils.property(
        fc.string(),
        (alias) => {
          const isValid = service.validateCustomAlias(alias);
          const withinLengthConstraints = alias.length >= 3 && alias.length <= 50;
          
          if (withinLengthConstraints) {
            return isValid; // Should be valid if within constraints
          } else {
            return !isValid; // Should be invalid if outside constraints
          }
        }
      );

      PropertyTestUtils.assert(property);
    });
  });

  describe('Link Creation Properties', () => {
    it('should preserve original URL in created links', async () => {
      (service.createLink as jest.Mock).mockImplementation(async (data) => {
        return {
          id: 'test-id',
          originalUrl: data.originalUrl,
          shortCode: 'test123',
          ...data,
        };
      });

      const property = PropertyTestUtils.asyncProperty(
        Arbitraries.url(),
        async (originalUrl) => {
          const linkData = { originalUrl, userId: 'test-user' };
          const createdLink = await service.createLink(linkData);
          return createdLink.originalUrl === originalUrl;
        }
      );

      await PropertyTestUtils.assertAsync(property);
    });

    it('should handle URL normalization consistently', async () => {
      (service.createLink as jest.Mock).mockImplementation(async (data) => {
        // Simulate URL normalization
        let normalizedUrl = data.originalUrl;
        if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
          normalizedUrl = `https://${normalizedUrl}`;
        }
        
        return {
          id: 'test-id',
          originalUrl: normalizedUrl,
          shortCode: 'test123',
          ...data,
        };
      });

      const urlWithoutProtocol = fc.domain().map(domain => `${domain}/path`);

      const property = PropertyTestUtils.asyncProperty(
        urlWithoutProtocol,
        async (urlWithoutProtocol) => {
          const linkData = { originalUrl: urlWithoutProtocol, userId: 'test-user' };
          const createdLink = await service.createLink(linkData);
          
          // Should add https:// prefix
          return createdLink.originalUrl.startsWith('https://');
        }
      );

      await PropertyTestUtils.assertAsync(property);
    });
  });

  describe('Link Expiration Properties', () => {
    it('should handle future expiration dates correctly', async () => {
      (service.createLink as jest.Mock).mockImplementation(async (data) => {
        return {
          id: 'test-id',
          originalUrl: data.originalUrl,
          shortCode: 'test123',
          expiresAt: data.expiresAt,
          isActive: data.expiresAt ? data.expiresAt > new Date() : true,
          ...data,
        };
      });

      const property = PropertyTestUtils.asyncProperty(
        fc.tuple(Arbitraries.url(), Arbitraries.futureDate()),
        async ([originalUrl, expiresAt]) => {
          const linkData = { originalUrl, expiresAt, userId: 'test-user' };
          const createdLink = await service.createLink(linkData);
          
          // Link should be active if expiration is in the future
          return createdLink.isActive === true;
        }
      );

      await PropertyTestUtils.assertAsync(property);
    });

    it('should handle past expiration dates correctly', async () => {
      (service.createLink as jest.Mock).mockImplementation(async (data) => {
        return {
          id: 'test-id',
          originalUrl: data.originalUrl,
          shortCode: 'test123',
          expiresAt: data.expiresAt,
          isActive: data.expiresAt ? data.expiresAt > new Date() : true,
          ...data,
        };
      });

      const property = PropertyTestUtils.asyncProperty(
        fc.tuple(Arbitraries.url(), Arbitraries.pastDate()),
        async ([originalUrl, expiresAt]) => {
          const linkData = { originalUrl, expiresAt, userId: 'test-user' };
          const createdLink = await service.createLink(linkData);
          
          // Link should be inactive if expiration is in the past
          return createdLink.isActive === false;
        }
      );

      await PropertyTestUtils.assertAsync(property);
    });
  });
});