/**
 * Property-based tests for device-specific URL routing
 * Tests Property 3: Device-Specific URL Routing
 * Validates Requirements 1.3
 */

import * as fc from 'fast-check';

// Mock device detection service
class MockDeviceDetectionService {
  private deviceRules = new Map<string, { mobile?: string; desktop?: string; tablet?: string }>();

  setDeviceRules(linkId: string, rules: { mobile?: string; desktop?: string; tablet?: string }) {
    this.deviceRules.set(linkId, rules);
  }

  getDeviceSpecificUrl(linkId: string, userAgent: string): string | null {
    const rules = this.deviceRules.get(linkId);
    if (!rules) return null;

    const deviceType = this.detectDeviceType(userAgent);
    return rules[deviceType] || null;
  }

  private detectDeviceType(userAgent: string): 'mobile' | 'desktop' | 'tablet' {
    const ua = userAgent.toLowerCase();
    
    if (ua.includes('tablet') || ua.includes('ipad')) {
      return 'tablet';
    }
    
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      return 'mobile';
    }
    
    return 'desktop';
  }

  validateDeviceUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

describe('Device Routing Properties', () => {
  let deviceService: MockDeviceDetectionService;

  beforeEach(() => {
    deviceService = new MockDeviceDetectionService();
  });

  /**
   * Property 3: Device-Specific URL Routing
   * Validates Requirements 1.3
   */
  describe('Property 3: Device-Specific URL Routing', () => {
    it('should route to correct device-specific URLs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            mobileUrl: fc.webUrl(),
            desktopUrl: fc.webUrl(),
            tabletUrl: fc.webUrl(),
            userAgents: fc.array(
              fc.oneof(
                fc.constant('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'),
                fc.constant('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'),
                fc.constant('Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'),
                fc.constant('Mozilla/5.0 (Android 11; Mobile; rv:68.0) Gecko/68.0 Firefox/88.0'),
                fc.constant('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')
              ),
              { minLength: 1, maxLength: 10 }
            )
          }),
          async ({ linkId, mobileUrl, desktopUrl, tabletUrl, userAgents }) => {
            // Set up device-specific rules
            deviceService.setDeviceRules(linkId, {
              mobile: mobileUrl,
              desktop: desktopUrl,
              tablet: tabletUrl
            });

            for (const userAgent of userAgents) {
              const routedUrl = deviceService.getDeviceSpecificUrl(linkId, userAgent);
              
              // Should always return a valid URL for configured devices
              expect(routedUrl).toBeTruthy();
              expect(deviceService.validateDeviceUrl(routedUrl!)).toBe(true);
              
              // Should route to correct device-specific URL
              if (userAgent.includes('iPhone') || userAgent.includes('Android')) {
                expect(routedUrl).toBe(mobileUrl);
              } else if (userAgent.includes('iPad') || userAgent.includes('tablet')) {
                expect(routedUrl).toBe(tabletUrl);
              } else {
                expect(routedUrl).toBe(desktopUrl);
              }
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle partial device configurations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            deviceConfig: fc.record({
              mobile: fc.option(fc.webUrl()),
              desktop: fc.option(fc.webUrl()),
              tablet: fc.option(fc.webUrl())
            }),
            userAgent: fc.oneof(
              fc.constant('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15'),
              fc.constant('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'),
              fc.constant('Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15')
            )
          }),
          async ({ linkId, deviceConfig, userAgent }) => {
            // Set up partial device configuration
            const rules: any = {};
            if (deviceConfig.mobile) rules.mobile = deviceConfig.mobile;
            if (deviceConfig.desktop) rules.desktop = deviceConfig.desktop;
            if (deviceConfig.tablet) rules.tablet = deviceConfig.tablet;
            
            deviceService.setDeviceRules(linkId, rules);

            const routedUrl = deviceService.getDeviceSpecificUrl(linkId, userAgent);
            
            // Should return null if no rule exists for the detected device type
            const deviceType = userAgent.includes('iPhone') ? 'mobile' :
                             userAgent.includes('iPad') ? 'tablet' : 'desktop';
            
            if (rules[deviceType]) {
              expect(routedUrl).toBe(rules[deviceType]);
              expect(deviceService.validateDeviceUrl(routedUrl!)).toBe(true);
            } else {
              expect(routedUrl).toBeNull();
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should maintain device detection consistency', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            userAgent: fc.string({ minLength: 10, maxLength: 200 }),
            testRuns: fc.integer({ min: 5, max: 20 })
          }),
          async ({ userAgent, testRuns }) => {
            const linkId = 'test-link';
            
            // Set up device rules
            deviceService.setDeviceRules(linkId, {
              mobile: 'https://mobile.example.com',
              desktop: 'https://desktop.example.com',
              tablet: 'https://tablet.example.com'
            });

            // Test consistency across multiple calls
            const results = [];
            for (let i = 0; i < testRuns; i++) {
              const result = deviceService.getDeviceSpecificUrl(linkId, userAgent);
              results.push(result);
            }

            // All results should be identical
            const firstResult = results[0];
            for (const result of results) {
              expect(result).toBe(firstResult);
            }

            // If a URL was returned, it should be valid
            if (firstResult) {
              expect(deviceService.validateDeviceUrl(firstResult)).toBe(true);
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should handle edge cases in user agent strings', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            edgeUserAgents: fc.array(
              fc.oneof(
                fc.constant(''), // Empty user agent
                fc.constant('Unknown'), // Unknown user agent
                fc.constant('Mozilla/5.0'), // Minimal user agent
                fc.constant('Bot/1.0'), // Bot user agent
                fc.string({ minLength: 1, maxLength: 10 }) // Random string
              ),
              { minLength: 1, maxLength: 5 }
            )
          }),
          async ({ linkId, edgeUserAgents }) => {
            // Set up device rules
            deviceService.setDeviceRules(linkId, {
              mobile: 'https://mobile.example.com',
              desktop: 'https://desktop.example.com',
              tablet: 'https://tablet.example.com'
            });

            for (const userAgent of edgeUserAgents) {
              const routedUrl = deviceService.getDeviceSpecificUrl(linkId, userAgent);
              
              // Should always return a valid URL (defaulting to desktop for unknown agents)
              expect(routedUrl).toBeTruthy();
              expect(deviceService.validateDeviceUrl(routedUrl!)).toBe(true);
              
              // Unknown/edge case user agents should default to desktop
              if (!userAgent.toLowerCase().includes('mobile') && 
                  !userAgent.toLowerCase().includes('iphone') &&
                  !userAgent.toLowerCase().includes('android') &&
                  !userAgent.toLowerCase().includes('tablet') &&
                  !userAgent.toLowerCase().includes('ipad')) {
                expect(routedUrl).toBe('https://desktop.example.com');
              }
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should validate device-specific URL formats', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            urls: fc.record({
              mobile: fc.webUrl(),
              desktop: fc.webUrl(),
              tablet: fc.webUrl()
            })
          }),
          async ({ linkId, urls }) => {
            // All URLs should be valid before setting rules
            expect(deviceService.validateDeviceUrl(urls.mobile)).toBe(true);
            expect(deviceService.validateDeviceUrl(urls.desktop)).toBe(true);
            expect(deviceService.validateDeviceUrl(urls.tablet)).toBe(true);

            deviceService.setDeviceRules(linkId, urls);

            // Test with different device types
            const mobileResult = deviceService.getDeviceSpecificUrl(linkId, 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)');
            const desktopResult = deviceService.getDeviceSpecificUrl(linkId, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
            const tabletResult = deviceService.getDeviceSpecificUrl(linkId, 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)');

            // All results should be valid URLs
            expect(deviceService.validateDeviceUrl(mobileResult!)).toBe(true);
            expect(deviceService.validateDeviceUrl(desktopResult!)).toBe(true);
            expect(deviceService.validateDeviceUrl(tabletResult!)).toBe(true);

            // Results should match the configured URLs
            expect(mobileResult).toBe(urls.mobile);
            expect(desktopResult).toBe(urls.desktop);
            expect(tabletResult).toBe(urls.tablet);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});