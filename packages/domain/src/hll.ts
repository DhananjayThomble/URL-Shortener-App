import { createHash } from "node:crypto";

/* ============================================================
   Approximate uniques: a HyperLogLog sketch we own.

   The obvious way to count unique visitors is one row per
   (link, day, visitor) and a COUNT(DISTINCT). At this product's
   target load that is billions of rows in a btree, which is a hard
   scale ceiling, not a tuning problem. The obvious fix is the
   postgresql-hll extension, and it is the wrong one here: it adds
   an extension to the "docker compose up" promise the single-node
   profile is built on, and it does not port to ClickHouse or Redis,
   so every future analytics adapter would need its own uniques
   implementation.

   So the sketch lives here, in pure TypeScript with no I/O. A sketch
   we own runs on vanilla Postgres, any managed Postgres, and behind
   any future analytics adapter unchanged. It is stored as a fixed
   16 KiB blob per (link, day) in a bytea column and merged during
   rollup by taking the register-wise maximum, which is what makes a
   rollup safe to re-run: merging is idempotent and commutative, so
   recomputing a day never inflates its uniques.

   The cost, which the UI must state plainly: uniques become
   approximate. At precision p=14 the standard error is
   1.04 / sqrt(16384) = 0.8125%, roughly 0.8%. Every analytics
   product at this scale reports approximate uniques; a hybrid
   "exact below a threshold, sketch above" design was considered and
   rejected because two code paths produce two numbers that disagree
   at the boundary, which is worse than being consistently
   approximate.
   ============================================================ */

/**
 * Precision. The register index is the top HLL_PRECISION bits of the
 * hashed value, so m = 2^p registers. p=14 is the sweet spot for this
 * product: ~0.81% error at a fixed 16 KiB per (link, day), which is
 * cheap enough to keep 45 days of history per link without a ceiling.
 */
export const HLL_PRECISION = 14;

/** m = 2^p = 16384 registers. */
export const HLL_REGISTER_COUNT = 1 << HLL_PRECISION;

/**
 * One byte per register. A register holds a "rank" (position of the
 * leftmost 1-bit) which for a 32-bit tail never exceeds ~33, so a
 * single byte is ample. This gives a fixed 16384-byte layout that maps
 * 1:1 to a Postgres bytea column and can be merged in a future
 * ClickHouse or Redis adapter without reinterpretation.
 */
export const HLL_BYTE_SIZE = HLL_REGISTER_COUNT;

/**
 * alpha_m bias-correction constant for the raw estimator. The general
 * form is 0.7213 / (1 + 1.079/m) for m >= 128, which m=16384 satisfies.
 */
const ALPHA_M = 0.7213 / (1 + 1.079 / HLL_REGISTER_COUNT);

/** 2^32, used by the large-range correction threshold and formula. */
const TWO_POW_32 = 2 ** 32;

/** A fresh, empty sketch: every register at rank 0. */
export function createSketch(): Uint8Array {
  return new Uint8Array(HLL_REGISTER_COUNT);
}

/**
 * Reduce the 32-hex-char (128-bit) visitorHash from visitor.ts to a
 * single 32-bit unsigned value that the HLL bit-extraction operates on.
 *
 * The visitorHash is an HMAC-SHA256 digest truncated to 128 bits, so it
 * is already a uniform, well-distributed digest. We fold it to 32 bits by
 * XORing its four 32-bit words. XOR of independent uniform words is still
 * uniform, which is all HLL needs, and it keeps the whole path allocation
 * free. Non-hex or wrong-length input would silently produce NaN words, so
 * we validate the shape and reject it loudly instead.
 */
function hashHexTo32Bit(hashHex: string): number {
  if (hashHex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hashHex)) {
    throw new Error(
      `hll: expected a 32-hex-char visitorHash, got ${JSON.stringify(hashHex)}`,
    );
  }
  let x = 0;
  for (let word = 0; word < 4; word++) {
    const offset = word * 8;
    // parseInt on an 8-hex-char slice yields a full 32-bit word.
    const value = parseInt(hashHex.slice(offset, offset + 8), 16);
    x = (x ^ value) >>> 0;
  }
  return x >>> 0;
}

/**
 * The core register update, shared by addHashed and the test path.
 *
 * Split the 32-bit value into:
 *  - index: the top HLL_PRECISION bits, selecting one of m registers;
 *  - tail:  the remaining (32 - HLL_PRECISION) bits, whose leftmost
 *           1-bit position (leading zeros + 1) is the register rank.
 *
 * If the tail is all zeros the rank is (32 - HLL_PRECISION) + 1, the
 * largest value the tail can justify. Each register keeps the maximum
 * rank it has ever seen, which is what makes repeated adds of the same
 * visitor idempotent.
 */
function addValue(sketch: Uint8Array, x: number): void {
  const index = x >>> (32 - HLL_PRECISION);
  const tailBits = 32 - HLL_PRECISION;
  // Shift the index bits off the top, keeping only the tail in a 32-bit slot.
  const tail = (x << HLL_PRECISION) >>> 0;
  // rank = position of the leftmost 1-bit within the tail, counting from 1.
  // Math.clz32 counts leading zeros of the full 32-bit word; the tail's own
  // leading zeros are that minus the HLL_PRECISION index bits we shifted in.
  const rank = tail === 0 ? tailBits + 1 : Math.clz32(tail) + 1;
  if (rank > sketch[index]!) {
    sketch[index] = rank;
  }
}

/**
 * Add one visitor to the sketch, in place, given the 32-hex-char
 * visitorHash produced by visitor.ts. Adding the same hash again is a
 * no-op on the estimate: the register can only stay at its current max.
 */
export function addHashed(sketch: Uint8Array, hashHex: string): void {
  if (sketch.length !== HLL_BYTE_SIZE) {
    throw new Error(
      `hll: sketch must be ${HLL_BYTE_SIZE} bytes, got ${sketch.length}`,
    );
  }
  addValue(sketch, hashHexTo32Bit(hashHex));
}

/**
 * Estimate the cardinality of the sketch using the standard HLL estimator
 * with the two canonical corrections.
 *
 *  - Raw estimate E = alpha_m * m^2 / sum(2^-register).
 *  - Small range: when E <= 2.5*m and some registers are still zero, the
 *    raw estimator is biased, so use linear counting m * ln(m / V) where V
 *    is the count of zero registers.
 *  - Large range: when E > 2^32 / 30, correct for 32-bit hash saturation
 *    with -2^32 * ln(1 - E/2^32).
 */
export function estimate(sketch: Uint8Array): number {
  if (sketch.length !== HLL_BYTE_SIZE) {
    throw new Error(
      `hll: sketch must be ${HLL_BYTE_SIZE} bytes, got ${sketch.length}`,
    );
  }
  const m = HLL_REGISTER_COUNT;
  let sum = 0;
  let zeros = 0;
  for (let i = 0; i < m; i++) {
    const rank = sketch[i]!;
    sum += 2 ** -rank;
    if (rank === 0) zeros++;
  }

  let e = (ALPHA_M * m * m) / sum;

  if (e <= 2.5 * m && zeros > 0) {
    // Linear counting is more accurate than the raw estimator in this range.
    e = m * Math.log(m / zeros);
  } else if (e > TWO_POW_32 / 30) {
    // Undo the collision bias of a 32-bit hash space near saturation.
    e = -TWO_POW_32 * Math.log(1 - e / TWO_POW_32);
  }

  return Math.max(0, Math.round(e));
}

/**
 * Merge two sketches into a new one by taking the element-wise maximum of
 * their registers. This is the operation the rollup relies on. Because max
 * is idempotent (max(a,a)=a) and commutative (max(a,b)=max(b,a)), re-running
 * a rollup over the same day can never change the uniques figure, which is
 * the invariant the old row-counting code protected with its
 * recompute-not-increment comment.
 */
export function merge(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== HLL_BYTE_SIZE || b.length !== HLL_BYTE_SIZE) {
    throw new Error(
      `hll: merge expects two ${HLL_BYTE_SIZE}-byte sketches, got ${a.length} and ${b.length}`,
    );
  }
  const out = new Uint8Array(HLL_REGISTER_COUNT);
  for (let i = 0; i < HLL_REGISTER_COUNT; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    out[i] = av > bv ? av : bv;
  }
  return out;
}

/**
 * Serialize a sketch to a Buffer for storage in a Postgres bytea column.
 * The layout is raw and dense (no compression) so it round-trips exactly
 * and can be merged in SQL or a future adapter without reinterpretation.
 */
export function serialize(sketch: Uint8Array): Buffer {
  if (sketch.length !== HLL_BYTE_SIZE) {
    throw new Error(
      `hll: cannot serialize a ${sketch.length}-byte sketch, expected ${HLL_BYTE_SIZE}`,
    );
  }
  return Buffer.from(sketch);
}

/**
 * Deserialize bytes read back from a bytea column into a sketch. Validates
 * the length so a truncated or foreign blob fails loudly rather than
 * producing silent nonsense. Copies into a fresh Uint8Array so the returned
 * sketch is independent of the caller's buffer.
 */
export function deserialize(bytes: Uint8Array | Buffer): Uint8Array {
  if (bytes.length !== HLL_BYTE_SIZE) {
    throw new Error(
      `hll: cannot deserialize ${bytes.length} bytes, expected ${HLL_BYTE_SIZE}`,
    );
  }
  return new Uint8Array(bytes);
}

/**
 * A deterministic 32-hex-char hash for a given input, matching the shape of
 * visitor.ts output. Kept here so both callers and tests can generate valid
 * synthetic hashes without reaching for crypto directly.
 */
export function hashForTesting(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}
