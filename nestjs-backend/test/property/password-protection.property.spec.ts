/**
 * Property-based tests for password protection security
 * Tests Property 7: Password Protection Security
 * Validates Requirements 2.1, 2.3, 2.4
 */

import * as fc from 'fast-check';
import * as bcrypt from 'bcrypt';

// Mock password protection service
class MockPasswordProtectionService {
  private passwordHashes = new Map<string, string>();
  private passwordHints = new Map<string, string>();
  private attemptCounts = new Map<string, number>();
  private lockoutTimes = new Map<string, number>();
  
  private readonly MAX_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

  async setPassword(linkId: string, password: string, hint?: string): Promise<void> {
    if (!this.validatePassword(password)) {
      throw new Error('Password does not meet security requirements');
    }

    const saltRounds = 12;
    const hash = await bcrypt.hash(password, saltRounds);
    this.passwordHashes.set(linkId, hash);
    
    if (hint) {
      this.passwordHints.set(linkId, hint);
    }
    
    // Reset attempt counts when password is set
    this.attemptCounts.delete(linkId);
    this.lockoutTimes.delete(linkId);
  }

  async verifyPassword(linkId: string, password: string, clientId: string): Promise<{ success: boolean; message?: string }> {
    const attemptKey = `${linkId}:${clientId}`;
    
    // Check if client is locked out
    if (this.isLockedOut(attemptKey)) {
      return { success: false, message: 'Too many failed attempts. Please try again later.' };
    }

    const hash = this.passwordHashes.get(linkId);
    if (!hash) {
      return { success: false, message: 'Link not found or not password protected' };
    }

    const isValid = await bcrypt.compare(password, hash);
    
    if (isValid) {
      // Reset attempt count on successful verification
      this.attemptCounts.delete(attemptKey);
      this.lockoutTimes.delete(attemptKey);
      return { success: true };
    } else {
      // Increment attempt count
      const attempts = (this.attemptCounts.get(attemptKey) || 0) + 1;
      this.attemptCounts.set(attemptKey, attempts);
      
      if (attempts >= this.MAX_ATTEMPTS) {
        this.lockoutTimes.set(attemptKey, Date.now());
        return { success: false, message: 'Too many failed attempts. Account locked.' };
      }
      
      return { success: false, message: `Invalid password. ${this.MAX_ATTEMPTS - attempts} attempts remaining.` };
    }
  }

  getPasswordHint(linkId: string): string | null {
    return this.passwordHints.get(linkId) || null;
  }

  isPasswordProtected(linkId: string): boolean {
    return this.passwordHashes.has(linkId);
  }

  private validatePassword(password: string): boolean {
    // Password must be at least 8 characters
    if (password.length < 8) return false;
    
    // Password must not be too long (prevent DoS)
    if (password.length > 128) return false;
    
    // Password must contain at least one letter and one number
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    
    return hasLetter && hasNumber;
  }

  private isLockedOut(attemptKey: string): boolean {
    const lockoutTime = this.lockoutTimes.get(attemptKey);
    if (!lockoutTime) return false;
    
    return Date.now() - lockoutTime < this.LOCKOUT_DURATION;
  }

  // Test helper methods
  getAttemptCount(linkId: string, clientId: string): number {
    return this.attemptCounts.get(`${linkId}:${clientId}`) || 0;
  }

  isClientLockedOut(linkId: string, clientId: string): boolean {
    return this.isLockedOut(`${linkId}:${clientId}`);
  }
}

describe('Password Protection Properties', () => {
  let passwordService: MockPasswordProtectionService;

  beforeEach(() => {
    passwordService = new MockPasswordProtectionService();
  });

  /**
   * Property 7: Password Protection Security
   * Validates Requirements 2.1, 2.3, 2.4
   */
  describe('Property 7: Password Protection Security', () => {
    it('should enforce password complexity requirements', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            validPasswords: fc.array(
              fc.string({ minLength: 8, maxLength: 128 })
                .filter(s => /[a-zA-Z]/.test(s) && /[0-9]/.test(s)),
              { minLength: 1, maxLength: 5 }
            ),
            invalidPasswords: fc.array(
              fc.oneof(
                fc.string({ minLength: 1, maxLength: 7 }), // Too short
                fc.string({ minLength: 129, maxLength: 200 }), // Too long
                fc.string({ minLength: 8, maxLength: 20 }).filter(s => !/[0-9]/.test(s)), // No numbers
                fc.string({ minLength: 8, maxLength: 20 }).filter(s => !/[a-zA-Z]/.test(s)) // No letters
              ),
              { minLength: 1, maxLength: 3 }
            )
          }),
          async ({ linkId, validPasswords, invalidPasswords }) => {
            // Valid passwords should be accepted
            for (const password of validPasswords) {
              await expect(passwordService.setPassword(linkId, password)).resolves.not.toThrow();
              expect(passwordService.isPasswordProtected(linkId)).toBe(true);
            }

            // Invalid passwords should be rejected
            for (const password of invalidPasswords) {
              await expect(passwordService.setPassword(linkId, password)).rejects.toThrow();
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should properly hash and verify passwords', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            password: fc.string({ minLength: 8, maxLength: 50 })
              .filter(s => /[a-zA-Z]/.test(s) && /[0-9]/.test(s)),
            clientId: fc.string({ minLength: 1, maxLength: 20 }),
            wrongPasswords: fc.array(
              fc.string({ minLength: 8, maxLength: 50 })
                .filter(s => /[a-zA-Z]/.test(s) && /[0-9]/.test(s)),
              { minLength: 1, maxLength: 3 }
            )
          }),
          async ({ linkId, password, clientId, wrongPasswords }) => {
            // Filter out passwords that might accidentally match
            const filteredWrongPasswords = wrongPasswords.filter(p => p !== password);
            fc.pre(filteredWrongPasswords.length > 0);

            await passwordService.setPassword(linkId, password);

            // Correct password should verify successfully
            const correctResult = await passwordService.verifyPassword(linkId, password, clientId);
            expect(correctResult.success).toBe(true);
            expect(correctResult.message).toBeUndefined();

            // Wrong passwords should fail verification
            for (const wrongPassword of filteredWrongPasswords) {
              const wrongResult = await passwordService.verifyPassword(linkId, wrongPassword, clientId);
              expect(wrongResult.success).toBe(false);
              expect(wrongResult.message).toBeTruthy();
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should implement rate limiting and lockout mechanisms', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            password: fc.string({ minLength: 8, maxLength: 50 })
              .filter(s => /[a-zA-Z]/.test(s) && /[0-9]/.test(s)),
            wrongPassword: fc.string({ minLength: 8, maxLength: 50 })
              .filter(s => /[a-zA-Z]/.test(s) && /[0-9]/.test(s)),
            clientId: fc.string({ minLength: 1, maxLength: 20 }),
            attemptCount: fc.integer({ min: 6, max: 10 })
          }),
          async ({ linkId, password, wrongPassword, clientId, attemptCount }) => {
            fc.pre(password !== wrongPassword);

            await passwordService.setPassword(linkId, password);

            // Make multiple failed attempts
            for (let i = 0; i < attemptCount; i++) {
              const result = await passwordService.verifyPassword(linkId, wrongPassword, clientId);
              expect(result.success).toBe(false);
              
              if (i < 4) {
                // First 4 attempts should show remaining attempts
                expect(result.message).toContain('attempts remaining');
              } else {
                // 5th and subsequent attempts should trigger lockout
                expect(result.message).toContain('locked');
              }
            }

            // Client should be locked out
            expect(passwordService.isClientLockedOut(linkId, clientId)).toBe(true);

            // Even correct password should be rejected during lockout
            const lockedResult = await passwordService.verifyPassword(linkId, password, clientId);
            expect(lockedResult.success).toBe(false);
            expect(lockedResult.message).toContain('Too many failed attempts');
          }
        ),
        { numRuns: 15 }
      );
    });

    it('should handle password hints securely', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            password: fc.string({ minLength: 8, maxLength: 50 })
              .filter(s => /[a-zA-Z]/.test(s) && /[0-9]/.test(s)),
            hint: fc.option(fc.string({ minLength: 1, maxLength: 100 }))
          }),
          async ({ linkId, password, hint }) => {
            await passwordService.setPassword(linkId, password, hint || undefined);

            const retrievedHint = passwordService.getPasswordHint(linkId);
            
            if (hint) {
              expect(retrievedHint).toBe(hint);
              // Hint should not contain the actual password
              expect(hint.toLowerCase()).not.toContain(password.toLowerCase());
            } else {
              expect(retrievedHint).toBeNull();
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should isolate lockouts by client ID', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            password: fc.string({ minLength: 8, maxLength: 50 })
              .filter(s => /[a-zA-Z]/.test(s) && /[0-9]/.test(s)),
            wrongPassword: fc.string({ minLength: 8, maxLength: 50 })
              .filter(s => /[a-zA-Z]/.test(s) && /[0-9]/.test(s)),
            clientId1: fc.string({ minLength: 1, maxLength: 20 }),
            clientId2: fc.string({ minLength: 1, maxLength: 20 })
          }),
          async ({ linkId, password, wrongPassword, clientId1, clientId2 }) => {
            fc.pre(password !== wrongPassword && clientId1 !== clientId2);

            await passwordService.setPassword(linkId, password);

            // Lock out client 1 with failed attempts
            for (let i = 0; i < 5; i++) {
              await passwordService.verifyPassword(linkId, wrongPassword, clientId1);
            }

            // Client 1 should be locked out
            expect(passwordService.isClientLockedOut(linkId, clientId1)).toBe(true);

            // Client 2 should not be affected
            expect(passwordService.isClientLockedOut(linkId, clientId2)).toBe(false);

            // Client 2 should be able to verify with correct password
            const client2Result = await passwordService.verifyPassword(linkId, password, clientId2);
            expect(client2Result.success).toBe(true);

            // Client 1 should still be locked out
            const client1Result = await passwordService.verifyPassword(linkId, password, clientId1);
            expect(client1Result.success).toBe(false);
            expect(client1Result.message).toContain('Too many failed attempts');
          }
        ),
        { numRuns: 15 }
      );
    });

    it('should reset attempt counts on successful verification', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            password: fc.string({ minLength: 8, maxLength: 50 })
              .filter(s => /[a-zA-Z]/.test(s) && /[0-9]/.test(s)),
            wrongPassword: fc.string({ minLength: 8, maxLength: 50 })
              .filter(s => /[a-zA-Z]/.test(s) && /[0-9]/.test(s)),
            clientId: fc.string({ minLength: 1, maxLength: 20 }),
            failedAttempts: fc.integer({ min: 1, max: 4 })
          }),
          async ({ linkId, password, wrongPassword, clientId, failedAttempts }) => {
            fc.pre(password !== wrongPassword);

            await passwordService.setPassword(linkId, password);

            // Make some failed attempts (but not enough to lock out)
            for (let i = 0; i < failedAttempts; i++) {
              await passwordService.verifyPassword(linkId, wrongPassword, clientId);
            }

            // Verify attempt count increased
            expect(passwordService.getAttemptCount(linkId, clientId)).toBe(failedAttempts);

            // Successful verification should reset attempt count
            const successResult = await passwordService.verifyPassword(linkId, password, clientId);
            expect(successResult.success).toBe(true);
            expect(passwordService.getAttemptCount(linkId, clientId)).toBe(0);

            // Should not be locked out
            expect(passwordService.isClientLockedOut(linkId, clientId)).toBe(false);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain password protection state consistency', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linkId: fc.string({ minLength: 1, maxLength: 20 }),
            passwords: fc.array(
              fc.string({ minLength: 8, maxLength: 50 })
                .filter(s => /[a-zA-Z]/.test(s) && /[0-9]/.test(s)),
              { minLength: 2, maxLength: 5 }
            ),
            clientId: fc.string({ minLength: 1, maxLength: 20 })
          }),
          async ({ linkId, passwords, clientId }) => {
            // Initially should not be password protected
            expect(passwordService.isPasswordProtected(linkId)).toBe(false);

            for (const password of passwords) {
              await passwordService.setPassword(linkId, password);
              
              // Should be password protected after setting
              expect(passwordService.isPasswordProtected(linkId)).toBe(true);
              
              // Should verify with current password
              const result = await passwordService.verifyPassword(linkId, password, clientId);
              expect(result.success).toBe(true);
              
              // Previous passwords should no longer work (if different)
              for (const oldPassword of passwords.slice(0, passwords.indexOf(password))) {
                if (oldPassword !== password) {
                  const oldResult = await passwordService.verifyPassword(linkId, oldPassword, clientId);
                  expect(oldResult.success).toBe(false);
                }
              }
            }
          }
        ),
        { numRuns: 15 }
      );
    });
  });
});