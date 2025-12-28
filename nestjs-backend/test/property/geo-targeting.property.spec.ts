/**
 * Property-based tests for geo-targeting rule processing
 * Tests Property 9: Geo-Targeting Rule Processing
 * Validates Requirements 3.2, 3.3, 3.4
 */

import * as fc from 'fast-check';

interface GeoRule {
  id: string;
  linkId: string;
  countries: string[];
  regions?: string[];
  cities?: string[];
  targetUrl: string;
  priority: number;
}

interface LocationData {
  country: string;
  region?: string;
  city?: string;
  ip: string;
}

// Mock geo-targeting service
class MockGeoTargetingService {
  private geoRules = new Map<string, GeoRule[]>();
  private ipLocationCache = new Map<string, LocationData>();

  addGeoRule(rule: GeoRule): void {
    if (!this.geoRules.has(rule.linkId)) {
      this.geoRules.set(rule.linkId, []);
    }
    
    const rules = this.geoRules.get(rule.linkId)!;
    rules.push(rule);
    
    // Sort by priority (higher priority first)
    rules.sort((a, b) => b.priority - a.priority);
  }

  setIPLocation(ip: string, location: LocationData): void {
    this.ipLocationCache.set(ip, location);
  }

  getTargetUrl(linkId: string, clientIP: string): string | null {
    const rules = this.geoRules.get(linkId);
    if (!rules || rules.length === 0) return null;

    const location = this.ipLocationCache.get(clientIP);
    if (!location) return null;

    // Find the first matching rule (highest priority)
    for (const rule of rules) {
      if (this.matchesGeoRule(rule, location)) {
        return rule.targetUrl;
      }
    }

    return null;
  }

  private matchesGeoRule(rule: GeoRule, location: LocationData): boolean {
    // Check country match
    if (!rule.countries.includes(location.country)) {
      return false;
    }

    // Check region match if specified
    if (rule.regions && rule.regions.length > 0) {
      if (!location.region || !rule.regions.includes(location.region)) {
        return false;
      }
    }

    // Check city match if specified
    if (rule.cities && rule.cities.length > 0) {
      if (!location.city || !rule.cities.includes(location.city)) {
        return false;
      }
    }

    return true;
  }

  validateGeoRule(rule: GeoRule): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!rule.id || rule.id.trim().length === 0) {
      errors.push('Rule ID is required');
    }

    if (!rule.linkId || rule.linkId.trim().length === 0) {
      errors.push('Link ID is required');
    }

    if (!rule.countries || rule.countries.length === 0) {
      errors.push('At least one country must be specified');
    }

    if (rule.countries) {
      for (const country of rule.countries) {
        if (!this.isValidCountryCode(country)) {
          errors.push(`Invalid country code: ${country}`);
        }
      }
    }

    if (!rule.targetUrl || !this.isValidUrl(rule.targetUrl)) {
      errors.push('Valid target URL is required');
    }

    if (rule.priority < 0 || rule.priority > 100) {
      errors.push('Priority must be between 0 and 100');
    }

    return { valid: errors.length === 0, errors };
  }

  private isValidCountryCode(code: string): boolean {
    // Simplified validation - in real implementation would use ISO country codes
    return code.length === 2 && /^[A-Z]{2}$/.test(code);
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  // Test helper methods
  getRulesForLink(linkId: string): GeoRule[] {
    return this.geoRules.get(linkId) || [];
  }

  clearRules(linkId: string): void {
    this.geoRules.delete(linkId);
  }
}

describe('Geo-Targeting Properties', () => {
  let geoService: MockGeoTargetingService;

  beforeEach(() => {
    geoService = new MockGeoTargetingService();
  });

  /**
   * Property 9: Geo-Targeting Rule Processing
   * Validates Requirements 3.2, 3.3, 3.4
   */
  describe('Property 9: Geo-Targeting Rule Processing', () => {
    it('should match geo rules based on location hierarchy', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            rules: fc.array(
              fc.record({
                id: fc.string({ minLength: 1, maxLength: 20 }),
                countries: fc.array(fc.constantFrom('US', 'CA', 'GB', 'DE', 'FR'), { minLength: 1, maxLength: 3 }),
                regions: fc.option(fc.array(fc.string({ minLength: 2, maxLength: 10 }), { minLength: 1, maxLength: 2 })),
                cities: fc.option(fc.array(fc.string({ minLength: 2, maxLength: 15 }), { minLength: 1, maxLength: 2 })),
                targetUrl: fc.webUrl(),
                priority: fc.integer({ min: 1, max: 100 })
              }),
              { minLength: 1, maxLength: 5 }
            ),
            testLocations: fc.array(
              fc.record({
                country: fc.constantFrom('US', 'CA', 'GB', 'DE', 'FR'),
                region: fc.option(fc.string({ minLength: 2, maxLength: 10 })),
                city: fc.option(fc.string({ minLength: 2, maxLength: 15 })),
                ip: fc.ipV4()
              }),
              { minLength: 1, maxLength: 10 }
            )
          }),
          async ({ linkId, rules, testLocations }) => {
            // Add all rules to the service
            for (const ruleData of rules) {
              const rule: GeoRule = {
                ...ruleData,
                linkId,
                regions: ruleData.regions || undefined,
                cities: ruleData.cities || undefined
              };
              geoService.addGeoRule(rule);
            }

            // Test each location
            for (const location of testLocations) {
              geoService.setIPLocation(location.ip, location);
              
              const targetUrl = geoService.getTargetUrl(linkId, location.ip);
              
              // Find expected matching rule (highest priority that matches)
              const matchingRules = rules
                .filter(rule => {
                  // Check country match
                  if (!rule.countries.includes(location.country)) return false;
                  
                  // Check region match if specified
                  if (rule.regions && rule.regions.length > 0) {
                    if (!location.region || !rule.regions.includes(location.region)) return false;
                  }
                  
                  // Check city match if specified
                  if (rule.cities && rule.cities.length > 0) {
                    if (!location.city || !rule.cities.includes(location.city)) return false;
                  }
                  
                  return true;
                })
                .sort((a, b) => b.priority - a.priority);

              if (matchingRules.length > 0) {
                expect(targetUrl).toBe(matchingRules[0].targetUrl);
              } else {
                expect(targetUrl).toBeNull();
              }
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should respect rule priority ordering', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            country: fc.constantFrom('US', 'CA', 'GB'),
            rules: fc.array(
              fc.record({
                id: fc.string({ minLength: 1, maxLength: 20 }),
                targetUrl: fc.webUrl(),
                priority: fc.integer({ min: 1, max: 100 })
              }),
              { minLength: 2, maxLength: 5 }
            ),
            clientIP: fc.ipV4()
          }),
          async ({ linkId, country, rules, clientIP }) => {
            // Ensure rules have different priorities
            const uniquePriorities = [...new Set(rules.map(r => r.priority))];
            fc.pre(uniquePriorities.length === rules.length);

            // Add rules that all match the same country
            for (const ruleData of rules) {
              const rule: GeoRule = {
                ...ruleData,
                linkId,
                countries: [country]
              };
              geoService.addGeoRule(rule);
            }

            // Set up location
            geoService.setIPLocation(clientIP, { country, ip: clientIP });

            const targetUrl = geoService.getTargetUrl(linkId, clientIP);
            
            // Should match the rule with highest priority
            const highestPriorityRule = rules.reduce((max, rule) => 
              rule.priority > max.priority ? rule : max
            );
            
            expect(targetUrl).toBe(highestPriorityRule.targetUrl);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should validate geo rule configurations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            validRules: fc.array(
              fc.record({
                id: fc.string({ minLength: 1, maxLength: 20 }),
                linkId: fc.string({ minLength: 1, maxLength: 20 }),
                countries: fc.array(fc.constantFrom('US', 'CA', 'GB', 'DE', 'FR'), { minLength: 1, maxLength: 3 }),
                targetUrl: fc.webUrl(),
                priority: fc.integer({ min: 0, max: 100 })
              }),
              { minLength: 1, maxLength: 3 }
            ),
            invalidRules: fc.array(
              fc.record({
                id: fc.oneof(fc.constant(''), fc.string({ minLength: 1, maxLength: 20 })),
                linkId: fc.oneof(fc.constant(''), fc.string({ minLength: 1, maxLength: 20 })),
                countries: fc.oneof(
                  fc.constant([]),
                  fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 2 })
                ),
                targetUrl: fc.oneof(fc.constant('invalid-url'), fc.webUrl()),
                priority: fc.oneof(
                  fc.integer({ min: -10, max: -1 }),
                  fc.integer({ min: 101, max: 200 }),
                  fc.integer({ min: 0, max: 100 })
                )
              }),
              { minLength: 1, maxLength: 2 }
            )
          }),
          async ({ validRules, invalidRules }) => {
            // Valid rules should pass validation
            for (const rule of validRules) {
              const validation = geoService.validateGeoRule(rule as GeoRule);
              expect(validation.valid).toBe(true);
              expect(validation.errors).toHaveLength(0);
            }

            // Invalid rules should fail validation
            for (const rule of invalidRules) {
              const validation = geoService.validateGeoRule(rule as GeoRule);
              
              // Check specific validation failures
              if (rule.id === '') {
                expect(validation.errors).toContain('Rule ID is required');
              }
              if (rule.linkId === '') {
                expect(validation.errors).toContain('Link ID is required');
              }
              if (Array.isArray(rule.countries) && rule.countries.length === 0) {
                expect(validation.errors).toContain('At least one country must be specified');
              }
              if (rule.targetUrl === 'invalid-url') {
                expect(validation.errors).toContain('Valid target URL is required');
              }
              if (rule.priority < 0 || rule.priority > 100) {
                expect(validation.errors).toContain('Priority must be between 0 and 100');
              }
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should handle overlapping geo rules correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            baseCountry: fc.constantFrom('US', 'CA', 'GB'),
            region: fc.string({ minLength: 2, maxLength: 10 }),
            city: fc.string({ minLength: 2, maxLength: 15 }),
            clientIP: fc.ipV4()
          }),
          async ({ linkId, baseCountry, region, city, clientIP }) => {
            // Create overlapping rules with different specificity
            const countryRule: GeoRule = {
              id: 'country-rule',
              linkId,
              countries: [baseCountry],
              targetUrl: 'https://country.example.com',
              priority: 10
            };

            const regionRule: GeoRule = {
              id: 'region-rule',
              linkId,
              countries: [baseCountry],
              regions: [region],
              targetUrl: 'https://region.example.com',
              priority: 20
            };

            const cityRule: GeoRule = {
              id: 'city-rule',
              linkId,
              countries: [baseCountry],
              regions: [region],
              cities: [city],
              targetUrl: 'https://city.example.com',
              priority: 30
            };

            // Add rules in random order
            const rules = [countryRule, regionRule, cityRule];
            for (const rule of rules) {
              geoService.addGeoRule(rule);
            }

            // Test with full location data (should match most specific rule)
            geoService.setIPLocation(clientIP, {
              country: baseCountry,
              region,
              city,
              ip: clientIP
            });

            const fullLocationResult = geoService.getTargetUrl(linkId, clientIP);
            expect(fullLocationResult).toBe(cityRule.targetUrl);

            // Test with partial location data (should match less specific rule)
            const partialIP = '192.168.1.2';
            geoService.setIPLocation(partialIP, {
              country: baseCountry,
              region,
              ip: partialIP
            });

            const partialLocationResult = geoService.getTargetUrl(linkId, partialIP);
            expect(partialLocationResult).toBe(regionRule.targetUrl);

            // Test with minimal location data (should match least specific rule)
            const minimalIP = '192.168.1.3';
            geoService.setIPLocation(minimalIP, {
              country: baseCountry,
              ip: minimalIP
            });

            const minimalLocationResult = geoService.getTargetUrl(linkId, minimalIP);
            expect(minimalLocationResult).toBe(countryRule.targetUrl);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should handle missing location data gracefully', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            rules: fc.array(
              fc.record({
                id: fc.string({ minLength: 1, maxLength: 20 }),
                countries: fc.array(fc.constantFrom('US', 'CA', 'GB'), { minLength: 1, maxLength: 2 }),
                targetUrl: fc.webUrl(),
                priority: fc.integer({ min: 1, max: 100 })
              }),
              { minLength: 1, maxLength: 3 }
            ),
            unknownIPs: fc.array(fc.ipV4(), { minLength: 1, maxLength: 5 })
          }),
          async ({ linkId, rules, unknownIPs }) => {
            // Add rules
            for (const ruleData of rules) {
              const rule: GeoRule = {
                ...ruleData,
                linkId
              };
              geoService.addGeoRule(rule);
            }

            // Test with IPs that have no location data
            for (const ip of unknownIPs) {
              const result = geoService.getTargetUrl(linkId, ip);
              expect(result).toBeNull();
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain rule consistency across multiple links', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            links: fc.array(
              fc.record({
                linkId: fc.string({ minLength: 1, maxLength: 20 }),
                rules: fc.array(
                  fc.record({
                    id: fc.string({ minLength: 1, maxLength: 20 }),
                    countries: fc.array(fc.constantFrom('US', 'CA', 'GB'), { minLength: 1, maxLength: 2 }),
                    targetUrl: fc.webUrl(),
                    priority: fc.integer({ min: 1, max: 100 })
                  }),
                  { minLength: 1, maxLength: 3 }
                )
              }),
              { minLength: 2, maxLength: 4 }
            ),
            testLocation: fc.record({
              country: fc.constantFrom('US', 'CA', 'GB'),
              ip: fc.ipV4()
            })
          }),
          async ({ links, testLocation }) => {
            // Ensure unique link IDs
            const uniqueLinkIds = [...new Set(links.map(l => l.linkId))];
            fc.pre(uniqueLinkIds.length === links.length);

            // Add rules for each link
            for (const link of links) {
              for (const ruleData of link.rules) {
                const rule: GeoRule = {
                  ...ruleData,
                  linkId: link.linkId
                };
                geoService.addGeoRule(rule);
              }
            }

            // Set up location
            geoService.setIPLocation(testLocation.ip, testLocation);

            // Test each link independently
            for (const link of links) {
              const result = geoService.getTargetUrl(link.linkId, testLocation.ip);
              
              // Find expected result for this specific link
              const matchingRules = link.rules
                .filter(rule => rule.countries.includes(testLocation.country))
                .sort((a, b) => b.priority - a.priority);

              if (matchingRules.length > 0) {
                expect(result).toBe(matchingRules[0].targetUrl);
              } else {
                expect(result).toBeNull();
              }

              // Verify rules are isolated per link
              const linkRules = geoService.getRulesForLink(link.linkId);
              expect(linkRules).toHaveLength(link.rules.length);
            }
          }
        ),
        { numRuns: 15 }
      );
    });
  });
});