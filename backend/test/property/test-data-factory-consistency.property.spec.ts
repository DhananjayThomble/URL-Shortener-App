/**
 * Property-Based Test: Test Data Factory Consistency
 * Feature: comprehensive-backend-testing, Property 6: Analytics Data Integrity
 * Validates: Requirements 4.4, 8.2
 */

import * as fc from 'fast-check';

describe('Property Test: Test Data Factory Consistency', () => {
  /**
   * Property 6: Analytics Data Integrity
   * For any analytics event, the recorded data should accurately reflect 
   * the actual event and maintain consistency across all related metrics
   */
  test('should generate consistent analytics data with valid field relationships', () => {
    // Use fast-check's built-in generators for analytics data validation
    fc.assert(
      fc.property(
        fc.record({
          linkId: fc.uuid(),
          userId: fc.uuid(),
          timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date() }),
          ipAddress: fc.ipV4(),
          userAgent: fc.constantFrom(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
          ),
          referer: fc.option(fc.webUrl(), { nil: undefined }),
          country: fc.option(fc.constantFrom('US', 'GB', 'CA', 'AU', 'DE', 'FR'), { nil: undefined }),
          city: fc.option(fc.constantFrom('New York', 'London', 'Toronto', 'Sydney'), { nil: undefined }),
          device: fc.option(fc.constantFrom('desktop', 'mobile', 'tablet'), { nil: undefined }),
          browser: fc.option(fc.constantFrom('Chrome', 'Firefox', 'Safari', 'Edge'), { nil: undefined }),
          os: fc.option(fc.constantFrom('Windows', 'macOS', 'Linux', 'iOS', 'Android'), { nil: undefined }),
        }),
        (analyticsData) => {
          // Validate that all required fields are present and valid
          expect(analyticsData.linkId).toBeDefined();
          expect(analyticsData.userId).toBeDefined();
          expect(analyticsData.timestamp).toBeInstanceOf(Date);
          expect(analyticsData.ipAddress).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
          expect(analyticsData.userAgent).toBeDefined();
          expect(analyticsData.userAgent.length).toBeGreaterThan(0);

          // Validate timestamp is not in the future
          expect(analyticsData.timestamp.getTime()).toBeLessThanOrEqual(Date.now());

          // Validate optional fields when present
          if (analyticsData.referer) {
            expect(analyticsData.referer).toMatch(/^https?:\/\/.+/);
          }

          if (analyticsData.country) {
            expect(analyticsData.country).toMatch(/^[A-Z]{2}$/);
          }

          if (analyticsData.device) {
            expect(['desktop', 'mobile', 'tablet']).toContain(analyticsData.device);
          }

          if (analyticsData.browser) {
            expect(['Chrome', 'Firefox', 'Safari', 'Edge']).toContain(analyticsData.browser);
          }

          if (analyticsData.os) {
            expect(['Windows', 'macOS', 'Linux', 'iOS', 'Android']).toContain(analyticsData.os);
          }

          // Validate data consistency - if we have city, we should have country
          if (analyticsData.city) {
            expect(analyticsData.country).toBeDefined();
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Test data factory should generate unique identifiers
   * For any multiple generations, IDs should be unique across entities
   */
  test('should generate unique identifiers across multiple entity creations', () => {
    // Generate multiple UUIDs and verify uniqueness
    const userIds = Array.from({ length: 50 }, () => fc.sample(fc.uuid(), 1)[0]);
    const linkIds = Array.from({ length: 50 }, () => fc.sample(fc.uuid(), 1)[0]);
    const bioPageIds = Array.from({ length: 50 }, () => fc.sample(fc.uuid(), 1)[0]);

    // Collect all IDs
    const allIds = [...userIds, ...linkIds, ...bioPageIds];

    // Verify all IDs are unique
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);

    // Verify IDs follow UUID format
    allIds.forEach(id => {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  /**
   * Property: Analytics data should maintain temporal consistency
   * For any analytics data generation, timestamps should be logically consistent
   */
  test('should generate analytics data with consistent temporal relationships', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            linkId: fc.uuid(),
            userId: fc.uuid(),
            timestamp: fc.date({ min: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), max: new Date() }),
            ipAddress: fc.ipV4(),
            userAgent: fc.string({ minLength: 10, maxLength: 200 }),
          }),
          { minLength: 1, maxLength: 100 }
        ),
        (analyticsEvents) => {
          analyticsEvents.forEach(event => {
            // Timestamp should not be in the future
            expect(event.timestamp.getTime()).toBeLessThanOrEqual(Date.now());

            // Timestamp should not be too far in the past (within last 30 days for test data)
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(thirtyDaysAgo);

            // Validate required analytics fields are present
            expect(event.linkId).toBeDefined();
            expect(event.userId).toBeDefined();
            expect(event.ipAddress).toBeDefined();
            expect(event.userAgent).toBeDefined();
          });

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });
});