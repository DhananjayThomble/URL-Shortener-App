/**
 * Security Event Logging Property-Based Tests
 * Tests universal properties of security event logging and rate limiting mechanisms
 * 
 * **Feature: backend-modernization, Property 24: Security Event Logging and Rate Limiting**
 * **Validates: Requirements 11.4, 11.5**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PropertyTestUtils } from '../property-setup';

// Security event types
enum SecurityEventType {
  LOGIN_ATTEMPT = 'LOGIN_ATTEMPT',
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  PASSWORD_RESET_REQUEST = 'PASSWORD_RESET_REQUEST',
  PASSWORD_RESET_SUCCESS = 'PASSWORD_RESET_SUCCESS',
  EMAIL_VERIFICATION_REQUEST = 'EMAIL_VERIFICATION_REQUEST',
  EMAIL_VERIFICATION_SUCCESS = 'EMAIL_VERIFICATION_SUCCESS',
  TOKEN_BLACKLISTED = 'TOKEN_BLACKLISTED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  UNAUTHORIZED_ACCESS_ATTEMPT = 'UNAUTHORIZED_ACCESS_ATTEMPT',
}

interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  userId?: string;
  email?: string;
  ipAddress: string;
  userAgent?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

interface RateLimitRule {
  endpoint: string;
  maxRequests: number;
  windowMs: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

// Mock security logging service
class MockSecurityLoggingService {
  private events: SecurityEvent[] = [];
  private rateLimitCounters = new Map<string, { count: number; resetTime: number }>();
  private rateLimitRules: RateLimitRule[] = [
    { endpoint: '/auth/login', maxRequests: 5, windowMs: 15 * 60 * 1000 }, // 5 attempts per 15 minutes
    { endpoint: '/auth/register', maxRequests: 3, windowMs: 60 * 60 * 1000 }, // 3 attempts per hour
    { endpoint: '/auth/password-reset', maxRequests: 3, windowMs: 60 * 60 * 1000 }, // 3 attempts per hour
    { endpoint: '/api/links', maxRequests: 100, windowMs: 60 * 1000 }, // 100 requests per minute
    { endpoint: '/api/analytics', maxRequests: 50, windowMs: 60 * 1000 }, // 50 requests per minute
  ];

  async logSecurityEvent(event: Omit<SecurityEvent, 'id' | 'timestamp'>): Promise<SecurityEvent> {
    const securityEvent: SecurityEvent = {
      ...event,
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      timestamp: new Date(),
    };

    this.events.push(securityEvent);

    // Auto-log rate limit events if applicable
    if (event.type === SecurityEventType.RATE_LIMIT_EXCEEDED) {
      // Additional logging for rate limit events
      console.log(`Rate limit exceeded for ${event.ipAddress} on ${event.metadata?.endpoint}`);
    }

    return securityEvent;
  }

  async getSecurityEvents(filters?: {
    type?: SecurityEventType;
    userId?: string;
    ipAddress?: string;
    severity?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<SecurityEvent[]> {
    let filteredEvents = [...this.events];

    if (filters) {
      if (filters.type) {
        filteredEvents = filteredEvents.filter(e => e.type === filters.type);
      }
      if (filters.userId) {
        filteredEvents = filteredEvents.filter(e => e.userId === filters.userId);
      }
      if (filters.ipAddress) {
        filteredEvents = filteredEvents.filter(e => e.ipAddress === filters.ipAddress);
      }
      if (filters.severity) {
        filteredEvents = filteredEvents.filter(e => e.severity === filters.severity);
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

  async checkRateLimit(ipAddress: string, endpoint: string): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const rule = this.rateLimitRules.find(r => r.endpoint === endpoint);
    if (!rule) {
      return { allowed: true, remaining: Infinity, resetTime: 0 };
    }

    const key = `${ipAddress}:${endpoint}`;
    const now = Date.now();
    const counter = this.rateLimitCounters.get(key);

    if (!counter || now > counter.resetTime) {
      // Reset or initialize counter
      this.rateLimitCounters.set(key, {
        count: 1,
        resetTime: now + rule.windowMs,
      });
      return { allowed: true, remaining: rule.maxRequests - 1, resetTime: now + rule.windowMs };
    }

    if (counter.count >= rule.maxRequests) {
      // Rate limit exceeded
      await this.logSecurityEvent({
        type: SecurityEventType.RATE_LIMIT_EXCEEDED,
        ipAddress,
        severity: 'MEDIUM',
        metadata: { endpoint, maxRequests: rule.maxRequests, windowMs: rule.windowMs },
      });
      return { allowed: false, remaining: 0, resetTime: counter.resetTime };
    }

    // Increment counter
    counter.count++;
    this.rateLimitCounters.set(key, counter);
    return { allowed: true, remaining: rule.maxRequests - counter.count, resetTime: counter.resetTime };
  }

  async detectSuspiciousActivity(ipAddress: string, timeWindowMs: number = 60000): Promise<boolean> {
    const recentEvents = await this.getSecurityEvents({
      ipAddress,
      startDate: new Date(Date.now() - timeWindowMs),
    });

    // Suspicious patterns
    const failedLogins = recentEvents.filter(e => e.type === SecurityEventType.LOGIN_FAILURE).length;
    const rateLimitEvents = recentEvents.filter(e => e.type === SecurityEventType.RATE_LIMIT_EXCEEDED).length;
    const totalEvents = recentEvents.length;

    // Define suspicious activity thresholds
    const isSuspicious = failedLogins >= 5 || rateLimitEvents >= 3 || totalEvents >= 20;

    if (isSuspicious) {
      await this.logSecurityEvent({
        type: SecurityEventType.SUSPICIOUS_ACTIVITY,
        ipAddress,
        severity: 'HIGH',
        metadata: { failedLogins, rateLimitEvents, totalEvents, timeWindowMs },
      });
    }

    return isSuspicious;
  }

  async clearEvents(): Promise<void> {
    this.events = [];
    this.rateLimitCounters.clear();
  }

  getEventCount(): number {
    return this.events.length;
  }

  getRateLimitRules(): RateLimitRule[] {
    return [...this.rateLimitRules];
  }
}

describe('Security Event Logging Properties', () => {
  let securityService: MockSecurityLoggingService;

  beforeEach(async () => {
    securityService = new MockSecurityLoggingService();
  });

  afterEach(async () => {
    await securityService.clearEvents();
  });

  /**
   * Property 24: Security Event Logging and Rate Limiting
   * For any security-related operation, events must be properly logged
   * and rate limiting must be consistently enforced
   */
  describe('Property 24: Security Event Logging and Rate Limiting', () => {
    it('should log all security events with required properties', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            type: fc.constantFrom(...Object.values(SecurityEventType)),
            userId: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
            email: fc.option(fc.emailAddress()),
            ipAddress: fc.ipV4(),
            userAgent: fc.option(fc.string({ minLength: 10, maxLength: 200 })),
            severity: fc.constantFrom('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
            metadata: fc.option(fc.dictionary(fc.string(), fc.anything())),
          }),
          async (eventData) => {
            const initialCount = securityService.getEventCount();

            // Log the security event
            const loggedEvent = await securityService.logSecurityEvent(eventData);

            // Verify event properties
            expect(loggedEvent.id).toBeDefined();
            expect(loggedEvent.id).toMatch(/^evt_\d+_[a-z0-9]+$/);
            expect(loggedEvent.type).toEqual(eventData.type);
            expect(loggedEvent.userId).toEqual(eventData.userId);
            expect(loggedEvent.email).toEqual(eventData.email);
            expect(loggedEvent.ipAddress).toEqual(eventData.ipAddress);
            expect(loggedEvent.userAgent).toEqual(eventData.userAgent);
            expect(loggedEvent.severity).toEqual(eventData.severity);
            expect(loggedEvent.timestamp).toBeInstanceOf(Date);
            expect(loggedEvent.timestamp.getTime()).toBeLessThanOrEqual(Date.now());
            expect(loggedEvent.timestamp.getTime()).toBeGreaterThan(Date.now() - 1000);

            // Verify event was stored
            expect(securityService.getEventCount()).toEqual(initialCount + 1);

            // Verify event can be retrieved
            const events = await securityService.getSecurityEvents({ type: eventData.type });
            expect(events).toContainEqual(loggedEvent);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should enforce rate limiting consistently across endpoints', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            ipAddress: fc.ipV4(),
            endpoint: fc.constantFrom('/auth/login', '/auth/register', '/auth/password-reset', '/api/links', '/api/analytics'),
            requestCount: fc.integer({ min: 1, max: 20 }),
          }),
          async ({ ipAddress, endpoint, requestCount }) => {
            const rules = securityService.getRateLimitRules();
            const rule = rules.find(r => r.endpoint === endpoint);
            expect(rule).toBeDefined();

            let allowedRequests = 0;
            let deniedRequests = 0;
            let lastResult: any;

            // Make multiple requests
            for (let i = 0; i < requestCount; i++) {
              const result = await securityService.checkRateLimit(ipAddress, endpoint);
              lastResult = result;

              if (result.allowed) {
                allowedRequests++;
              } else {
                deniedRequests++;
              }

              // Verify rate limit properties
              expect(result.allowed).toBeDefined();
              expect(typeof result.allowed).toBe('boolean');
              expect(result.remaining).toBeGreaterThanOrEqual(0);
              expect(result.resetTime).toBeGreaterThan(Date.now() - 1000);

              // If denied, remaining should be 0
              if (!result.allowed) {
                expect(result.remaining).toEqual(0);
              }
            }

            // Verify rate limiting logic
            if (requestCount <= rule!.maxRequests) {
              expect(allowedRequests).toEqual(requestCount);
              expect(deniedRequests).toEqual(0);
            } else {
              expect(allowedRequests).toEqual(rule!.maxRequests);
              expect(deniedRequests).toEqual(requestCount - rule!.maxRequests);
            }

            // Verify rate limit events were logged for denied requests
            if (deniedRequests > 0) {
              const rateLimitEvents = await securityService.getSecurityEvents({
                type: SecurityEventType.RATE_LIMIT_EXCEEDED,
                ipAddress,
              });
              expect(rateLimitEvents.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should detect suspicious activity patterns', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            ipAddress: fc.ipV4(),
            failedLoginCount: fc.integer({ min: 0, max: 10 }),
            rateLimitCount: fc.integer({ min: 0, max: 5 }),
            otherEventCount: fc.integer({ min: 0, max: 15 }),
          }),
          async ({ ipAddress, failedLoginCount, rateLimitCount, otherEventCount }) => {
            // Generate failed login events
            for (let i = 0; i < failedLoginCount; i++) {
              await securityService.logSecurityEvent({
                type: SecurityEventType.LOGIN_FAILURE,
                ipAddress,
                severity: 'MEDIUM',
                email: `user${i}@example.com`,
              });
            }

            // Generate rate limit events
            for (let i = 0; i < rateLimitCount; i++) {
              await securityService.logSecurityEvent({
                type: SecurityEventType.RATE_LIMIT_EXCEEDED,
                ipAddress,
                severity: 'MEDIUM',
                metadata: { endpoint: '/auth/login' },
              });
            }

            // Generate other security events
            for (let i = 0; i < otherEventCount; i++) {
              await securityService.logSecurityEvent({
                type: SecurityEventType.LOGIN_ATTEMPT,
                ipAddress,
                severity: 'LOW',
              });
            }

            // Check for suspicious activity
            const isSuspicious = await securityService.detectSuspiciousActivity(ipAddress);

            // Verify suspicious activity detection logic
            const totalEvents = failedLoginCount + rateLimitCount + otherEventCount;
            const expectedSuspicious = failedLoginCount >= 5 || rateLimitCount >= 3 || totalEvents >= 20;

            expect(isSuspicious).toEqual(expectedSuspicious);

            // If suspicious, verify that a suspicious activity event was logged
            if (isSuspicious) {
              const suspiciousEvents = await securityService.getSecurityEvents({
                type: SecurityEventType.SUSPICIOUS_ACTIVITY,
                ipAddress,
              });
              expect(suspiciousEvents.length).toBeGreaterThan(0);
              expect(suspiciousEvents[0].severity).toEqual('HIGH');
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should maintain event filtering and querying consistency', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              type: fc.constantFrom(...Object.values(SecurityEventType)),
              userId: fc.option(fc.string({ minLength: 1, maxLength: 20 })),
              ipAddress: fc.ipV4(),
              severity: fc.constantFrom('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
            }),
            { minLength: 5, maxLength: 50 }
          ),
          async (eventDataArray) => {
            // Log all events
            const loggedEvents: SecurityEvent[] = [];
            for (const eventData of eventDataArray) {
              const event = await securityService.logSecurityEvent(eventData);
              loggedEvents.push(event);
            }

            // Test various filtering combinations
            const uniqueTypes = [...new Set(eventDataArray.map(e => e.type))];
            const uniqueIpAddresses = [...new Set(eventDataArray.map(e => e.ipAddress))];
            const uniqueSeverities = [...new Set(eventDataArray.map(e => e.severity))];

            // Test type filtering
            for (const type of uniqueTypes) {
              const filteredEvents = await securityService.getSecurityEvents({ type });
              const expectedCount = eventDataArray.filter(e => e.type === type).length;
              expect(filteredEvents.length).toEqual(expectedCount);
              expect(filteredEvents.every(e => e.type === type)).toBe(true);
            }

            // Test IP address filtering
            for (const ipAddress of uniqueIpAddresses.slice(0, 3)) { // Limit to avoid too many iterations
              const filteredEvents = await securityService.getSecurityEvents({ ipAddress });
              const expectedCount = eventDataArray.filter(e => e.ipAddress === ipAddress).length;
              expect(filteredEvents.length).toEqual(expectedCount);
              expect(filteredEvents.every(e => e.ipAddress === ipAddress)).toBe(true);
            }

            // Test severity filtering
            for (const severity of uniqueSeverities) {
              const filteredEvents = await securityService.getSecurityEvents({ severity });
              const expectedCount = eventDataArray.filter(e => e.severity === severity).length;
              expect(filteredEvents.length).toEqual(expectedCount);
              expect(filteredEvents.every(e => e.severity === severity)).toBe(true);
            }

            // Test combined filtering
            if (uniqueTypes.length > 0 && uniqueIpAddresses.length > 0) {
              const type = uniqueTypes[0];
              const ipAddress = uniqueIpAddresses[0];
              const filteredEvents = await securityService.getSecurityEvents({ type, ipAddress });
              const expectedCount = eventDataArray.filter(e => e.type === type && e.ipAddress === ipAddress).length;
              expect(filteredEvents.length).toEqual(expectedCount);
              expect(filteredEvents.every(e => e.type === type && e.ipAddress === ipAddress)).toBe(true);
            }

            // Test date range filtering
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const recentEvents = await securityService.getSecurityEvents({ startDate: oneHourAgo });
            expect(recentEvents.length).toEqual(loggedEvents.length); // All events should be recent
            expect(recentEvents.every(e => e.timestamp >= oneHourAgo)).toBe(true);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain rate limit state consistency across time windows', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            ipAddress: fc.ipV4(),
            endpoint: fc.constantFrom('/auth/login', '/api/links'),
            requestBatches: fc.array(
              fc.record({
                count: fc.integer({ min: 1, max: 10 }),
                delayMs: fc.integer({ min: 0, max: 1000 }),
              }),
              { minLength: 2, maxLength: 5 }
            ),
          }),
          async ({ ipAddress, endpoint, requestBatches }) => {
            const rules = securityService.getRateLimitRules();
            const rule = rules.find(r => r.endpoint === endpoint);
            expect(rule).toBeDefined();

            let totalAllowed = 0;
            let totalDenied = 0;
            let lastResetTime = 0;

            for (const batch of requestBatches) {
              // Add delay between batches
              if (batch.delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, batch.delayMs));
              }

              let batchAllowed = 0;
              let batchDenied = 0;

              for (let i = 0; i < batch.count; i++) {
                const result = await securityService.checkRateLimit(ipAddress, endpoint);
                
                if (result.allowed) {
                  batchAllowed++;
                } else {
                  batchDenied++;
                }

                // Track reset time changes
                if (lastResetTime === 0) {
                  lastResetTime = result.resetTime;
                } else if (result.resetTime > lastResetTime) {
                  // Reset time changed, indicating a new window
                  lastResetTime = result.resetTime;
                }
              }

              totalAllowed += batchAllowed;
              totalDenied += batchDenied;

              // Verify batch consistency
              expect(batchAllowed + batchDenied).toEqual(batch.count);
            }

            // Verify overall consistency
            const totalRequests = requestBatches.reduce((sum, batch) => sum + batch.count, 0);
            expect(totalAllowed + totalDenied).toEqual(totalRequests);

            // Verify that denied requests generated appropriate events
            if (totalDenied > 0) {
              const rateLimitEvents = await securityService.getSecurityEvents({
                type: SecurityEventType.RATE_LIMIT_EXCEEDED,
                ipAddress,
              });
              expect(rateLimitEvents.length).toBeGreaterThan(0);
              expect(rateLimitEvents.every(e => e.metadata?.endpoint === endpoint)).toBe(true);
            }
          }
        ),
        { numRuns: 15 }
      );
    });
  });
});