/**
 * Analytics Data Capture Property-Based Tests
 * Tests universal properties of comprehensive analytics data capture
 * 
 * **Feature: backend-modernization, Property 6: Comprehensive Analytics Data Capture**
 * **Validates: Requirements 1.6**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { PropertyTestUtils } from '../property-setup';

interface ClickEvent {
  id: string;
  linkId: string;
  alias: string;
  ipAddress: string;
  userAgent: string;
  referer?: string;
  country?: string;
  city?: string;
  device: string;
  browser: string;
  os: string;
  timestamp: Date;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

interface AnalyticsRequest {
  linkId: string;
  alias: string;
  ipAddress: string;
  userAgent: string;
  referer?: string;
  utmParams?: Record<string, string>;
}

// Mock analytics service
class MockAnalyticsService {
  private clickEvents: ClickEvent[] = [];
  private geoDatabase = new Map<string, { country: string; city: string }>();
  private userAgentParser = new Map<string, { device: string; browser: string; os: string }>();

  constructor() {
    // Mock geo data
    this.geoDatabase.set('192.168.1.1', { country: 'United States', city: 'New York' });
    this.geoDatabase.set('10.0.0.1', { country: 'Canada', city: 'Toronto' });
    this.geoDatabase.set('172.16.0.1', { country: 'United Kingdom', city: 'London' });
    
    // Mock user agent parsing
    this.userAgentParser.set('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 
      { device: 'Desktop', browser: 'Chrome', os: 'Windows' });
    this.userAgentParser.set('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)', 
      { device: 'Mobile', browser: 'Safari', os: 'iOS' });
    this.userAgentParser.set('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 
      { device: 'Desktop', browser: 'Safari', os: 'macOS' });
  }

  async captureClickEvent(request: AnalyticsRequest): Promise<ClickEvent> {
    // Parse geo location
    const geoData = this.geoDatabase.get(request.ipAddress) || { country: 'Unknown', city: 'Unknown' };
    
    // Parse user agent
    const uaData = this.parseUserAgent(request.userAgent);
    
    // Extract UTM parameters
    const utmParams = this.extractUtmParams(request.utmParams);

    const clickEvent: ClickEvent = {
      id: `click_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      linkId: request.linkId,
      alias: request.alias,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      referer: request.referer,
      country: geoData.country,
      city: geoData.city,
      device: uaData.device,
      browser: uaData.browser,
      os: uaData.os,
      timestamp: new Date(),
      ...utmParams,
    };

    this.clickEvents.push(clickEvent);
    return clickEvent;
  }

  async getClickEvents(filters?: {
    linkId?: string;
    alias?: string;
    country?: string;
    device?: string;
    browser?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<ClickEvent[]> {
    let filteredEvents = [...this.clickEvents];

    if (filters) {
      if (filters.linkId) {
        filteredEvents = filteredEvents.filter(e => e.linkId === filters.linkId);
      }
      if (filters.alias) {
        filteredEvents = filteredEvents.filter(e => e.alias === filters.alias);
      }
      if (filters.country) {
        filteredEvents = filteredEvents.filter(e => e.country === filters.country);
      }
      if (filters.device) {
        filteredEvents = filteredEvents.filter(e => e.device === filters.device);
      }
      if (filters.browser) {
        filteredEvents = filteredEvents.filter(e => e.browser === filters.browser);
      }
      if (filters.startDate) {
        filteredEvents = filteredEvents.filter(e => e.timestamp >= filters.startDate!);
      }
      if (filters.endDate) {
        filteredEvents = filteredEvents.filter(e => e.timestamp <= filters.endDate!);
      }
    }

    return filteredEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async getAnalyticsSummary(linkId: string): Promise<{
    totalClicks: number;
    uniqueClicks: number;
    topCountries: Array<{ country: string; count: number }>;
    topDevices: Array<{ device: string; count: number }>;
    topBrowsers: Array<{ browser: string; count: number }>;
    topReferers: Array<{ referer: string; count: number }>;
    utmSources: Array<{ source: string; count: number }>;
  }> {
    const events = await this.getClickEvents({ linkId });
    const uniqueIps = new Set(events.map(e => e.ipAddress));

    // Aggregate data
    const countryCount = new Map<string, number>();
    const deviceCount = new Map<string, number>();
    const browserCount = new Map<string, number>();
    const refererCount = new Map<string, number>();
    const utmSourceCount = new Map<string, number>();

    for (const event of events) {
      // Count countries
      if (event.country) {
        countryCount.set(event.country, (countryCount.get(event.country) || 0) + 1);
      }
      
      // Count devices
      deviceCount.set(event.device, (deviceCount.get(event.device) || 0) + 1);
      
      // Count browsers
      browserCount.set(event.browser, (browserCount.get(event.browser) || 0) + 1);
      
      // Count referers
      if (event.referer) {
        refererCount.set(event.referer, (refererCount.get(event.referer) || 0) + 1);
      }
      
      // Count UTM sources
      if (event.utmSource) {
        utmSourceCount.set(event.utmSource, (utmSourceCount.get(event.utmSource) || 0) + 1);
      }
    }

    return {
      totalClicks: events.length,
      uniqueClicks: uniqueIps.size,
      topCountries: Array.from(countryCount.entries())
        .map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topDevices: Array.from(deviceCount.entries())
        .map(([device, count]) => ({ device, count }))
        .sort((a, b) => b.count - a.count),
      topBrowsers: Array.from(browserCount.entries())
        .map(([browser, count]) => ({ browser, count }))
        .sort((a, b) => b.count - a.count),
      topReferers: Array.from(refererCount.entries())
        .map(([referer, count]) => ({ referer, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      utmSources: Array.from(utmSourceCount.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private parseUserAgent(userAgent: string): { device: string; browser: string; os: string } {
    // Simple user agent parsing
    const parsed = this.userAgentParser.get(userAgent);
    if (parsed) return parsed;

    // Default parsing logic
    let device = 'Desktop';
    let browser = 'Unknown';
    let os = 'Unknown';

    if (userAgent.includes('Mobile') || userAgent.includes('iPhone') || userAgent.includes('Android')) {
      device = 'Mobile';
    } else if (userAgent.includes('Tablet') || userAgent.includes('iPad')) {
      device = 'Tablet';
    }

    if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else if (userAgent.includes('Edge')) browser = 'Edge';

    if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Mac OS X')) os = 'macOS';
    else if (userAgent.includes('Linux')) os = 'Linux';
    else if (userAgent.includes('iOS')) os = 'iOS';
    else if (userAgent.includes('Android')) os = 'Android';

    return { device, browser, os };
  }

  private extractUtmParams(utmParams?: Record<string, string>): Partial<ClickEvent> {
    if (!utmParams) return {};

    return {
      utmSource: utmParams.utm_source,
      utmMedium: utmParams.utm_medium,
      utmCampaign: utmParams.utm_campaign,
      utmTerm: utmParams.utm_term,
      utmContent: utmParams.utm_content,
    };
  }

  // Test utilities
  getAllEvents(): ClickEvent[] {
    return [...this.clickEvents];
  }

  clear(): void {
    this.clickEvents = [];
  }
}

describe('Analytics Data Capture Properties', () => {
  let analyticsService: MockAnalyticsService;

  beforeEach(() => {
    analyticsService = new MockAnalyticsService();
  });

  afterEach(() => {
    analyticsService.clear();
  });

  /**
   * Property 6: Comprehensive Analytics Data Capture
   * For any click event, all relevant analytics data must be captured
   * and stored with proper categorization and metadata
   */
  describe('Property 6: Comprehensive Analytics Data Capture', () => {
    it('should capture all required analytics data for every click event', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              linkId: fc.string({ minLength: 5, maxLength: 20 }),
              alias: fc.string({ minLength: 3, maxLength: 15 }),
              ipAddress: fc.ipV4(),
              userAgent: fc.constantFrom(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                'Mozilla/5.0 (Android 10; Mobile; rv:81.0) Gecko/81.0 Firefox/81.0'
              ),
              referer: fc.option(fc.webUrl()),
              utmParams: fc.option(fc.record({
                utm_source: fc.string({ minLength: 1, maxLength: 20 }),
                utm_medium: fc.string({ minLength: 1, maxLength: 20 }),
                utm_campaign: fc.string({ minLength: 1, maxLength: 30 }),
                utm_term: fc.option(fc.string({ minLength: 1, maxLength: 20 })),
                utm_content: fc.option(fc.string({ minLength: 1, maxLength: 20 })),
              })),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          async (clickRequests) => {
            const capturedEvents: ClickEvent[] = [];

            // Capture all click events
            for (const request of clickRequests) {
              const event = await analyticsService.captureClickEvent(request);
              capturedEvents.push(event);

              // Verify all required fields are captured
              expect(event.id).toBeDefined();
              expect(event.id).toMatch(/^click_\d+_[a-z0-9]+$/);
              expect(event.linkId).toEqual(request.linkId);
              expect(event.alias).toEqual(request.alias);
              expect(event.ipAddress).toEqual(request.ipAddress);
              expect(event.userAgent).toEqual(request.userAgent);
              expect(event.referer).toEqual(request.referer);
              expect(event.timestamp).toBeInstanceOf(Date);
              expect(event.timestamp.getTime()).toBeLessThanOrEqual(Date.now());

              // Verify geo data is captured
              expect(event.country).toBeDefined();
              expect(event.city).toBeDefined();
              expect(typeof event.country).toBe('string');
              expect(typeof event.city).toBe('string');

              // Verify device/browser/OS data is captured
              expect(event.device).toBeDefined();
              expect(event.browser).toBeDefined();
              expect(event.os).toBeDefined();
              expect(['Desktop', 'Mobile', 'Tablet']).toContain(event.device);

              // Verify UTM parameters are captured if provided
              if (request.utmParams) {
                if (request.utmParams.utm_source) {
                  expect(event.utmSource).toEqual(request.utmParams.utm_source);
                }
                if (request.utmParams.utm_medium) {
                  expect(event.utmMedium).toEqual(request.utmParams.utm_medium);
                }
                if (request.utmParams.utm_campaign) {
                  expect(event.utmCampaign).toEqual(request.utmParams.utm_campaign);
                }
              }
            }

            // Verify all events are stored
            const allEvents = analyticsService.getAllEvents();
            expect(allEvents.length).toEqual(clickRequests.length);

            // Verify event uniqueness
            const eventIds = allEvents.map(e => e.id);
            const uniqueIds = new Set(eventIds);
            expect(uniqueIds.size).toEqual(eventIds.length);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should provide accurate analytics filtering and querying', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            events: fc.array(
              fc.record({
                linkId: fc.constantFrom('link1', 'link2', 'link3'),
                alias: fc.constantFrom('alias1', 'alias2', 'alias3'),
                ipAddress: fc.constantFrom('192.168.1.1', '10.0.0.1', '172.16.0.1'),
                userAgent: fc.constantFrom(
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
                ),
                referer: fc.option(fc.constantFrom('https://google.com', 'https://facebook.com', 'https://twitter.com')),
              }),
              { minLength: 10, maxLength: 30 }
            ),
          }),
          async ({ events }) => {
            // Capture all events
            const capturedEvents: ClickEvent[] = [];
            for (const eventData of events) {
              const event = await analyticsService.captureClickEvent(eventData);
              capturedEvents.push(event);
            }

            // Test filtering by linkId
            const uniqueLinkIds = [...new Set(events.map(e => e.linkId))];
            for (const linkId of uniqueLinkIds) {
              const filteredEvents = await analyticsService.getClickEvents({ linkId });
              const expectedCount = events.filter(e => e.linkId === linkId).length;
              expect(filteredEvents.length).toEqual(expectedCount);
              expect(filteredEvents.every(e => e.linkId === linkId)).toBe(true);
            }

            // Test filtering by alias
            const uniqueAliases = [...new Set(events.map(e => e.alias))];
            for (const alias of uniqueAliases) {
              const filteredEvents = await analyticsService.getClickEvents({ alias });
              const expectedCount = events.filter(e => e.alias === alias).length;
              expect(filteredEvents.length).toEqual(expectedCount);
              expect(filteredEvents.every(e => e.alias === alias)).toBe(true);
            }

            // Test filtering by device type
            const deviceTypes = [...new Set(capturedEvents.map(e => e.device))];
            for (const device of deviceTypes) {
              const filteredEvents = await analyticsService.getClickEvents({ device });
              expect(filteredEvents.every(e => e.device === device)).toBe(true);
            }

            // Test filtering by country
            const countries = [...new Set(capturedEvents.map(e => e.country).filter(Boolean))];
            for (const country of countries) {
              const filteredEvents = await analyticsService.getClickEvents({ country });
              expect(filteredEvents.every(e => e.country === country)).toBe(true);
            }

            // Test date range filtering
            if (capturedEvents.length > 0) {
              const timestamps = capturedEvents.map(e => e.timestamp.getTime()).sort();
              const midTime = new Date(timestamps[Math.floor(timestamps.length / 2)]);
              
              const eventsAfterMid = await analyticsService.getClickEvents({ startDate: midTime });
              expect(eventsAfterMid.every(e => e.timestamp >= midTime)).toBe(true);
              
              const eventsBeforeMid = await analyticsService.getClickEvents({ endDate: midTime });
              expect(eventsBeforeMid.every(e => e.timestamp <= midTime)).toBe(true);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should generate accurate analytics summaries', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 5, maxLength: 15 }),
            clickEvents: fc.array(
              fc.record({
                ipAddress: fc.constantFrom('192.168.1.1', '10.0.0.1', '172.16.0.1', '192.168.1.2'),
                userAgent: fc.constantFrom(
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
                ),
                referer: fc.option(fc.constantFrom('https://google.com', 'https://facebook.com')),
                utmParams: fc.option(fc.record({
                  utm_source: fc.constantFrom('google', 'facebook', 'twitter'),
                  utm_medium: fc.constantFrom('cpc', 'social', 'email'),
                  utm_campaign: fc.string({ minLength: 3, maxLength: 10 }),
                })),
              }),
              { minLength: 5, maxLength: 25 }
            ),
          }),
          async ({ linkId, clickEvents }) => {
            // Capture all events for the link
            for (const eventData of clickEvents) {
              await analyticsService.captureClickEvent({
                linkId,
                alias: 'test-alias',
                ...eventData,
              });
            }

            // Get analytics summary
            const summary = await analyticsService.getAnalyticsSummary(linkId);

            // Verify total clicks
            expect(summary.totalClicks).toEqual(clickEvents.length);

            // Verify unique clicks (based on unique IP addresses)
            const uniqueIps = new Set(clickEvents.map(e => e.ipAddress));
            expect(summary.uniqueClicks).toEqual(uniqueIps.size);

            // Verify top countries aggregation
            const countryCount = new Map<string, number>();
            for (const event of clickEvents) {
              // Map IP to country based on our mock data
              let country = 'Unknown';
              if (event.ipAddress === '192.168.1.1') country = 'United States';
              else if (event.ipAddress === '10.0.0.1') country = 'Canada';
              else if (event.ipAddress === '172.16.0.1') country = 'United Kingdom';
              
              countryCount.set(country, (countryCount.get(country) || 0) + 1);
            }
            
            expect(summary.topCountries.length).toBeGreaterThan(0);
            for (const countryData of summary.topCountries) {
              expect(countryCount.get(countryData.country)).toEqual(countryData.count);
            }

            // Verify device aggregation
            expect(summary.topDevices.length).toBeGreaterThan(0);
            const totalDeviceClicks = summary.topDevices.reduce((sum, d) => sum + d.count, 0);
            expect(totalDeviceClicks).toEqual(clickEvents.length);

            // Verify browser aggregation
            expect(summary.topBrowsers.length).toBeGreaterThan(0);
            const totalBrowserClicks = summary.topBrowsers.reduce((sum, b) => sum + b.count, 0);
            expect(totalBrowserClicks).toEqual(clickEvents.length);

            // Verify UTM source aggregation
            const utmSourceCount = new Map<string, number>();
            for (const event of clickEvents) {
              if (event.utmParams?.utm_source) {
                const source = event.utmParams.utm_source;
                utmSourceCount.set(source, (utmSourceCount.get(source) || 0) + 1);
              }
            }
            
            for (const utmData of summary.utmSources) {
              expect(utmSourceCount.get(utmData.source)).toEqual(utmData.count);
            }

            // Verify referer aggregation
            const refererCount = new Map<string, number>();
            for (const event of clickEvents) {
              if (event.referer) {
                refererCount.set(event.referer, (refererCount.get(event.referer) || 0) + 1);
              }
            }
            
            for (const refererData of summary.topReferers) {
              expect(refererCount.get(refererData.referer)).toEqual(refererData.count);
            }
          }
        ),
        { numRuns: 15 }
      );
    });

    it('should maintain data consistency across concurrent captures', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 5, maxLength: 15 }),
            concurrentEvents: fc.array(
              fc.record({
                ipAddress: fc.ipV4(),
                userAgent: fc.constantFrom(
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)'
                ),
              }),
              { minLength: 5, maxLength: 15 }
            ),
          }),
          async ({ linkId, concurrentEvents }) => {
            // Capture events concurrently
            const capturePromises = concurrentEvents.map(eventData =>
              analyticsService.captureClickEvent({
                linkId,
                alias: 'concurrent-test',
                ...eventData,
              })
            );

            const capturedEvents = await Promise.all(capturePromises);

            // Verify all events were captured
            expect(capturedEvents.length).toEqual(concurrentEvents.length);

            // Verify event uniqueness
            const eventIds = capturedEvents.map(e => e.id);
            const uniqueIds = new Set(eventIds);
            expect(uniqueIds.size).toEqual(eventIds.length);

            // Verify all events are retrievable
            const retrievedEvents = await analyticsService.getClickEvents({ linkId });
            expect(retrievedEvents.length).toEqual(concurrentEvents.length);

            // Verify data integrity
            for (let i = 0; i < capturedEvents.length; i++) {
              const captured = capturedEvents[i];
              const original = concurrentEvents[i];
              
              expect(captured.linkId).toEqual(linkId);
              expect(captured.ipAddress).toEqual(original.ipAddress);
              expect(captured.userAgent).toEqual(original.userAgent);
              expect(captured.device).toBeDefined();
              expect(captured.browser).toBeDefined();
              expect(captured.os).toBeDefined();
            }

            // Verify summary accuracy
            const summary = await analyticsService.getAnalyticsSummary(linkId);
            expect(summary.totalClicks).toEqual(concurrentEvents.length);
            
            const uniqueIps = new Set(concurrentEvents.map(e => e.ipAddress));
            expect(summary.uniqueClicks).toEqual(uniqueIps.size);
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});