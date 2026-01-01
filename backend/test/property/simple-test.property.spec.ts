/**
 * Simple Property Test to verify setup
 */

import * as fc from 'fast-check';

describe('Simple Property Test', () => {
  test('should work with basic property test', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(typeof n).toBe('number');
        return true;
      }),
      { numRuns: 10 }
    );
  });
});