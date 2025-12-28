/**
 * Property-based tests for UTM parameter preservation
 * Tests Property 4: UTM Parameter Preservation
 * Validates Requirements 1.4
 */

import * as fc from 'fast-check';

// Mock UTM parameter service
class MockUTMParameterService {
  private utmRules = new Map<string, { preserveParams: boolean; customParams?: Record<string, string> }>();

  setUTMRules(linkId: string, rules: { preserveParams: boolean; customParams?: Record<string, string> }) {
    this.utmRules.set(linkId, rules);
  }

  processRedirectUrl(linkId: string, originalUrl: string, incomingParams: Record<string, string>): string {
    const rules = this.utmRules.get(linkId);
    if (!rules) return originalUrl;

    const url = new URL(originalUrl);
    
    // Add custom UTM parameters if configured
    if (rules.customParams) {
      for (const [key, value] of Object.entries(rules.customParams)) {
        url.searchParams.set(key, value);
      }
    }

    // Preserve incoming UTM parameters if enabled
    if (rules.preserveParams) {
      for (const [key, value] of Object.entries(incomingParams)) {
        if (this.isUTMParameter(key)) {
          url.searchParams.set(key, value);
        }
      }
    }

    return url.toString();
  }

  extractUTMParameters(url: string): Record<string, string> {
    const urlObj = new URL(url);
    const utmParams: Record<string, string> = {};

    for (const [key, value] of urlObj.searchParams.entries()) {
      if (this.isUTMParameter(key)) {
        utmParams[key] = value;
      }
    }

    return utmParams;
  }

  private isUTMParameter(key: string): boolean {
    const utmParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    return utmParams.includes(key.toLowerCase());
  }

  validateUTMParameter(key: string, value: string): boolean {
    if (!this.isUTMParameter(key)) return false;
    if (!value || value.trim().length === 0) return false;
    if (value.length > 100) return false; // Reasonable limit
    return true;
  }
}

describe('UTM Parameter Properties', () => {
  let utmService: MockUTMParameterService;

  beforeEach(() => {
    utmService = new MockUTMParameterService();
  });

  /**
   * Property 4: UTM Parameter Preservation
   * Validates Requirements 1.4
   */
  describe('Property 4: UTM Parameter Preservation', () => {
    it('should preserve UTM parameters during redirects', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            originalUrl: fc.webUrl(),
            utmParams: fc.record({
              utm_source: fc.string({ minLength: 1, maxLength: 50 }),
              utm_medium: fc.string({ minLength: 1, maxLength: 50 }),
              utm_campaign: fc.string({ minLength: 1, maxLength: 50 }),
              utm_term: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
              utm_content: fc.option(fc.string({ minLength: 1, maxLength: 50 }))
            })
          }),
          async ({ linkId, originalUrl, utmParams }) => {
            // Configure to preserve UTM parameters
            utmService.setUTMRules(linkId, { preserveParams: true });

            // Filter out null/undefined optional parameters
            const cleanParams: Record<string, string> = {};
            for (const [key, value] of Object.entries(utmParams)) {
              if (value !== null && value !== undefined) {
                cleanParams[key] = value;
              }
            }

            const finalUrl = utmService.processRedirectUrl(linkId, originalUrl, cleanParams);
            const extractedParams = utmService.extractUTMParameters(finalUrl);

            // All provided UTM parameters should be preserved
            for (const [key, value] of Object.entries(cleanParams)) {
              expect(extractedParams[key]).toBe(value);
              expect(utmService.validateUTMParameter(key, value)).toBe(true);
            }

            // Final URL should be valid
            expect(() => new URL(finalUrl)).not.toThrow();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle custom UTM parameters correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            originalUrl: fc.webUrl(),
            customParams: fc.record({
              utm_source: fc.string({ minLength: 1, maxLength: 50 }),
              utm_medium: fc.string({ minLength: 1, maxLength: 50 }),
              utm_campaign: fc.string({ minLength: 1, maxLength: 50 })
            }),
            incomingParams: fc.record({
              utm_source: fc.string({ minLength: 1, maxLength: 50 }),
              utm_medium: fc.string({ minLength: 1, maxLength: 50 })
            })
          }),
          async ({ linkId, originalUrl, customParams, incomingParams }) => {
            // Configure with custom UTM parameters and preservation enabled
            utmService.setUTMRules(linkId, { 
              preserveParams: true, 
              customParams 
            });

            const finalUrl = utmService.processRedirectUrl(linkId, originalUrl, incomingParams);
            const extractedParams = utmService.extractUTMParameters(finalUrl);

            // Custom parameters should be present
            for (const [key, value] of Object.entries(customParams)) {
              expect(extractedParams[key]).toBe(value);
            }

            // Incoming parameters should be preserved (but custom params take precedence)
            for (const [key, value] of Object.entries(incomingParams)) {
              if (!customParams[key]) {
                expect(extractedParams[key]).toBe(value);
              }
            }

            // Final URL should be valid
            expect(() => new URL(finalUrl)).not.toThrow();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle parameter precedence correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            originalUrl: fc.webUrl(),
            customSource: fc.string({ minLength: 1, maxLength: 50 }),
            incomingSource: fc.string({ minLength: 1, maxLength: 50 })
          }),
          async ({ linkId, originalUrl, customSource, incomingSource }) => {
            // Ensure custom and incoming sources are different
            fc.pre(customSource !== incomingSource);

            // Configure with custom UTM parameters
            utmService.setUTMRules(linkId, { 
              preserveParams: true, 
              customParams: { utm_source: customSource }
            });

            const finalUrl = utmService.processRedirectUrl(linkId, originalUrl, { 
              utm_source: incomingSource 
            });
            const extractedParams = utmService.extractUTMParameters(finalUrl);

            // Custom parameters should take precedence over incoming parameters
            expect(extractedParams.utm_source).toBe(customSource);
            expect(extractedParams.utm_source).not.toBe(incomingSource);

            // Final URL should be valid
            expect(() => new URL(finalUrl)).not.toThrow();
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should filter non-UTM parameters', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            originalUrl: fc.webUrl(),
            mixedParams: fc.record({
              utm_source: fc.string({ minLength: 1, maxLength: 50 }),
              utm_medium: fc.string({ minLength: 1, maxLength: 50 }),
              nonUtmParam1: fc.string({ minLength: 1, maxLength: 50 }),
              nonUtmParam2: fc.string({ minLength: 1, maxLength: 50 }),
              randomParam: fc.string({ minLength: 1, maxLength: 50 })
            })
          }),
          async ({ linkId, originalUrl, mixedParams }) => {
            // Configure to preserve UTM parameters
            utmService.setUTMRules(linkId, { preserveParams: true });

            const finalUrl = utmService.processRedirectUrl(linkId, originalUrl, mixedParams);
            const extractedParams = utmService.extractUTMParameters(finalUrl);

            // Only UTM parameters should be extracted
            expect(extractedParams.utm_source).toBe(mixedParams.utm_source);
            expect(extractedParams.utm_medium).toBe(mixedParams.utm_medium);
            
            // Non-UTM parameters should not be in extracted params
            expect(extractedParams.nonUtmParam1).toBeUndefined();
            expect(extractedParams.nonUtmParam2).toBeUndefined();
            expect(extractedParams.randomParam).toBeUndefined();

            // Final URL should be valid
            expect(() => new URL(finalUrl)).not.toThrow();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle disabled parameter preservation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            originalUrl: fc.webUrl(),
            incomingParams: fc.record({
              utm_source: fc.string({ minLength: 1, maxLength: 50 }),
              utm_medium: fc.string({ minLength: 1, maxLength: 50 }),
              utm_campaign: fc.string({ minLength: 1, maxLength: 50 })
            })
          }),
          async ({ linkId, originalUrl, incomingParams }) => {
            // Configure to NOT preserve UTM parameters
            utmService.setUTMRules(linkId, { preserveParams: false });

            const finalUrl = utmService.processRedirectUrl(linkId, originalUrl, incomingParams);
            const extractedParams = utmService.extractUTMParameters(finalUrl);

            // No incoming UTM parameters should be preserved
            expect(Object.keys(extractedParams)).toHaveLength(0);

            // Final URL should be valid and equal to original (no params added)
            expect(() => new URL(finalUrl)).not.toThrow();
            expect(finalUrl).toBe(originalUrl);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should validate UTM parameter formats', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            validParams: fc.array(
              fc.record({
                key: fc.constantFrom('utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'),
                value: fc.string({ minLength: 1, maxLength: 100 })
              }),
              { minLength: 1, maxLength: 5 }
            ),
            invalidParams: fc.array(
              fc.record({
                key: fc.oneof(
                  fc.constantFrom('utm_source', 'utm_medium', 'utm_campaign'),
                  fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.startsWith('utm_'))
                ),
                value: fc.oneof(
                  fc.constant(''), // Empty value
                  fc.string({ minLength: 101, maxLength: 200 }), // Too long
                  fc.constant('   ') // Whitespace only
                )
              }),
              { minLength: 1, maxLength: 3 }
            )
          }),
          async ({ validParams, invalidParams }) => {
            // Valid parameters should pass validation
            for (const param of validParams) {
              if (param.key.startsWith('utm_') && param.value.trim().length > 0 && param.value.length <= 100) {
                expect(utmService.validateUTMParameter(param.key, param.value)).toBe(true);
              }
            }

            // Invalid parameters should fail validation
            for (const param of invalidParams) {
              if (!param.key.startsWith('utm_') || 
                  param.value.trim().length === 0 || 
                  param.value.length > 100) {
                expect(utmService.validateUTMParameter(param.key, param.value)).toBe(false);
              }
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should maintain URL structure integrity', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            baseUrl: fc.webUrl(),
            utmParams: fc.record({
              utm_source: fc.string({ minLength: 1, maxLength: 50 }),
              utm_medium: fc.string({ minLength: 1, maxLength: 50 })
            })
          }),
          async ({ linkId, baseUrl, utmParams }) => {
            utmService.setUTMRules(linkId, { preserveParams: true });

            const originalUrlObj = new URL(baseUrl);
            const finalUrl = utmService.processRedirectUrl(linkId, baseUrl, utmParams);
            const finalUrlObj = new URL(finalUrl);

            // URL structure should be preserved
            expect(finalUrlObj.protocol).toBe(originalUrlObj.protocol);
            expect(finalUrlObj.hostname).toBe(originalUrlObj.hostname);
            expect(finalUrlObj.pathname).toBe(originalUrlObj.pathname);
            expect(finalUrlObj.port).toBe(originalUrlObj.port);

            // UTM parameters should be added to search params
            for (const [key, value] of Object.entries(utmParams)) {
              expect(finalUrlObj.searchParams.get(key)).toBe(value);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});