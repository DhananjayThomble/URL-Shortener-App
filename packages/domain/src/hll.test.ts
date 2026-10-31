import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  HLL_BYTE_SIZE,
  HLL_PRECISION,
  HLL_REGISTER_COUNT,
  addHashed,
  createSketch,
  deserialize,
  estimate,
  merge,
  serialize,
} from "./hll.js";

/* Uniques at this product's scale are approximate on purpose: the exact
   row-per-visitor table is a hard scale ceiling. These tests are the proof
   that the sketch we own is actually a HyperLogLog and not a stub - that its
   estimate tracks true cardinality within HLL's known error band, and that
   merge is the register-wise max that makes re-running a rollup safe. They
   run with no database and no network. */

/** Deterministic, reproducible synthetic visitor hashes (32 hex chars). */
const hashOf = (input: string): string =>
  createHash("sha256").update(input).digest("hex").slice(0, 32);

const sketchOf = (inputs: Iterable<string>): Uint8Array => {
  const s = createSketch();
  for (const input of inputs) addHashed(s, hashOf(input));
  return s;
};

const range = (start: number, end: number): string[] => {
  const out: string[] = [];
  for (let i = start; i < end; i++) out.push(`item-${i}`);
  return out;
};

describe("hll constants", () => {
  it("uses precision 14 with a fixed 16384-byte layout", () => {
    expect(HLL_PRECISION).toBe(14);
    expect(HLL_REGISTER_COUNT).toBe(16384);
    expect(HLL_BYTE_SIZE).toBe(16384);
  });
});

describe("createSketch", () => {
  it("is empty and estimates zero", () => {
    const s = createSketch();
    expect(s.length).toBe(HLL_BYTE_SIZE);
    expect(estimate(s)).toBe(0);
  });
});

describe("estimate accuracy", () => {
  // Linear counting dominates at small N, so allow it more headroom than the
  // 0.81% theoretical standard error; the raw estimator range must be tight.
  const cases: Array<{ n: number; tolerance: number }> = [
    { n: 100, tolerance: 0.1 },
    { n: 1000, tolerance: 0.05 },
    { n: 10000, tolerance: 0.03 },
    { n: 100000, tolerance: 0.03 },
  ];

  for (const { n, tolerance } of cases) {
    it(`estimates ${n} distinct items within ${tolerance * 100}%`, () => {
      const s = sketchOf(range(0, n));
      const est = estimate(s);
      const relativeError = Math.abs(est - n) / n;
      expect(relativeError).toBeLessThan(tolerance);
    });
  }

  it("estimates a handful of items close to the true small count", () => {
    const s = sketchOf(range(0, 7));
    // In the linear-counting range a small count should be near-exact.
    expect(estimate(s)).toBeGreaterThanOrEqual(6);
    expect(estimate(s)).toBeLessThanOrEqual(8);
  });
});

describe("addHashed", () => {
  it("is idempotent: adding the same hash many times does not inflate", () => {
    const s = createSketch();
    const h = hashOf("solo-visitor");
    for (let i = 0; i < 1000; i++) addHashed(s, h);
    expect(estimate(s)).toBeLessThanOrEqual(2);
  });

  it("rejects a hash that is not 32 hex chars", () => {
    const s = createSketch();
    expect(() => addHashed(s, "abc")).toThrow();
    expect(() => addHashed(s, "z".repeat(32))).toThrow();
  });

  it("rejects a wrong-size sketch", () => {
    expect(() => addHashed(new Uint8Array(10), hashOf("x"))).toThrow();
  });
});

describe("merge", () => {
  it("is register-wise max", () => {
    const a = createSketch();
    const b = createSketch();
    a[0] = 5;
    a[1] = 2;
    b[0] = 3;
    b[1] = 9;
    const m = merge(a, b);
    expect(m[0]).toBe(5);
    expect(m[1]).toBe(9);
  });

  it("is commutative register-for-register", () => {
    const a = sketchOf(range(0, 5000));
    const b = sketchOf(range(2500, 7500));
    const ab = merge(a, b);
    const ba = merge(b, a);
    expect(Array.from(ab)).toEqual(Array.from(ba));
  });

  it("is idempotent: merge(a, a) equals a", () => {
    const a = sketchOf(range(0, 5000));
    const aa = merge(a, a);
    expect(Array.from(aa)).toEqual(Array.from(a));
  });

  it("approximates the union cardinality of disjoint sets", () => {
    const a = sketchOf(range(0, 20000));
    const b = sketchOf(range(20000, 40000));
    const est = estimate(merge(a, b));
    // 40000 is a mid-range cardinality; a broken merge would be off by tens of
    // percent, so this band is tight enough to catch that while leaving room
    // above the 0.81% theoretical error for this fixed sample.
    expect(Math.abs(est - 40000) / 40000).toBeLessThan(0.04);
  });

  it("approximates the union cardinality of overlapping sets", () => {
    // Union of [0,30000) and [10000,40000) is [0,40000) = 40000 distinct.
    const a = sketchOf(range(0, 30000));
    const b = sketchOf(range(10000, 40000));
    const est = estimate(merge(a, b));
    expect(Math.abs(est - 40000) / 40000).toBeLessThan(0.04);
  });

  it("matches directly building the union sketch", () => {
    const a = sketchOf(range(0, 5000));
    const b = sketchOf(range(3000, 9000));
    const merged = merge(a, b);
    const direct = sketchOf(range(0, 9000));
    // Register-wise max of the two halves must equal the sketch built from
    // the union directly - the property the rollup depends on.
    expect(Array.from(merged)).toEqual(Array.from(direct));
  });

  it("rejects mismatched sizes", () => {
    expect(() => merge(createSketch(), new Uint8Array(10))).toThrow();
    expect(() => merge(new Uint8Array(10), createSketch())).toThrow();
  });
});

describe("serialize / deserialize", () => {
  it("round-trips to an identical sketch", () => {
    const s = sketchOf(range(0, 12345));
    const bytes = serialize(s);
    expect(bytes.length).toBe(HLL_BYTE_SIZE);
    const back = deserialize(bytes);
    expect(Array.from(back)).toEqual(Array.from(s));
    expect(estimate(back)).toBe(estimate(s));
  });

  it("produces a buffer independent of the source sketch", () => {
    const s = createSketch();
    const bytes = serialize(s);
    s[0] = 42;
    // Mutating the source after serialize must not change the serialized copy.
    expect(bytes[0]).toBe(0);
  });

  it("deserialize copies so the result is independent of input bytes", () => {
    const s = sketchOf(range(0, 100));
    const bytes = serialize(s);
    const back = deserialize(bytes);
    bytes[0] = 99;
    expect(back[0]).not.toBe(99);
  });

  it("rejects wrong-length input", () => {
    expect(() => deserialize(new Uint8Array(HLL_BYTE_SIZE - 1))).toThrow();
    expect(() => deserialize(new Uint8Array(HLL_BYTE_SIZE + 1))).toThrow();
    expect(() => serialize(new Uint8Array(10))).toThrow();
  });
});


/* #894 — mutation testing. The accuracy bands above prove the estimator works
   but leave the exact bit-math, the two range corrections, the error messages
   and hashForTesting unpinned. These tests drive crafted sketches directly so
   each branch and constant is exercised. */
describe("estimate — raw estimator math on a crafted sketch", () => {
  it("applies alpha_m * m^2 / sum with the documented constant", () => {
    // Put the same rank in every register so sum = m * 2^-rank is exact and
    // the small-range branch is skipped (no zero registers). Then the raw
    // estimate is alpha_m * m^2 / (m * 2^-rank) = alpha_m * m * 2^rank, which
    // pins ALPHA_M, the m*m numerator and the division.
    const rank = 4;
    const s = createSketch();
    s.fill(rank);
    const m = HLL_REGISTER_COUNT;
    const alpha = 0.7213 / (1 + 1.079 / m);
    const expectedRaw = (alpha * m * m) / (m * 2 ** -rank);
    expect(estimate(s)).toBe(Math.round(expectedRaw));
  });

  it("a single non-zero register still uses linear counting (zeros present)", () => {
    const s = createSketch();
    s[0] = 1;
    // zeros = m-1 > 0 and e is tiny, so linear counting m*ln(m/zeros) applies.
    const m = HLL_REGISTER_COUNT;
    const expected = Math.round(m * Math.log(m / (m - 1)));
    expect(estimate(s)).toBe(expected);
  });

  it("uses the RAW estimator when e is large even though a few registers are zero", () => {
    // Fill all-but-one register at rank 10 and leave exactly one at zero. Then
    // zeros = 1 (> 0) but the raw e is ~1.1e7, well above 2.5*m, so the small-
    // range guard `e <= 2.5*m && zeros > 0` is FALSE and the raw estimate is
    // used. This separates `&&` from `||` (|| would wrongly switch to linear
    // counting ~160039 because zeros>0) and the `e <= 2.5*m` -> true mutant
    // (which would also force linear counting).
    const m = HLL_REGISTER_COUNT;
    const s = createSketch();
    s.fill(10);
    s[0] = 0;
    const zeros = 1;
    const sum = 2 ** 0 + (m - 1) * 2 ** -10;
    const alpha = 0.7213 / (1 + 1.079 / m);
    const raw = (alpha * m * m) / sum;
    const TWO_POW_32 = 2 ** 32;
    expect(raw).toBeGreaterThan(2.5 * m); // not the small range
    expect(raw).toBeLessThan(TWO_POW_32 / 30); // not the large range
    // Correct result is the raw estimate, NOT the linear-counting value.
    const linear = m * Math.log(m / zeros);
    expect(estimate(s)).toBe(Math.round(raw));
    expect(estimate(s)).not.toBe(Math.round(linear));
  });
});

describe("estimate — large-range correction near 2^32 saturation", () => {
  it("applies the -2^32 ln(1 - E/2^32) correction when E exceeds 2^32/30", () => {
    // Fill every register with a rank that puts the raw E above the 2^32/30
    // threshold but still below 2^32 (so ln(1 - E/2^32) is defined), forcing
    // the large-range branch that no realistic cardinality in a test can reach.
    // raw = alpha_m * m * 2^rank; rank 15 lands raw ~3.9e8, in (2^32/30, 2^32).
    const rank = 15;
    const s = createSketch();
    s.fill(rank);
    const m = HLL_REGISTER_COUNT;
    const alpha = 0.7213 / (1 + 1.079 / m);
    const raw = (alpha * m * m) / (m * 2 ** -rank);
    const TWO_POW_32 = 2 ** 32;
    expect(raw).toBeGreaterThan(TWO_POW_32 / 30); // the branch really is taken
    const corrected = -TWO_POW_32 * Math.log(1 - raw / TWO_POW_32);
    expect(estimate(s)).toBe(Math.max(0, Math.round(corrected)));
    // The correction changes the estimate (it is not the raw value), and the
    // result is a finite non-negative count — not the NaN a dropped guard or a
    // flipped `1 - E/2^32` term would produce.
    expect(estimate(s)).not.toBe(Math.round(raw));
    expect(Number.isFinite(estimate(s))).toBe(true);
    expect(estimate(s)).toBeGreaterThan(0);
  });
});

describe("addHashed — register index and rank", () => {
  it("lands an all-ones folded value in the last register at rank 1", () => {
    // The 32-bit value is the XOR of the four 8-hex words. One word = ffffffff
    // and three zero words fold to x = 0xFFFFFFFF: index = top 14 bits = 16383,
    // tail = (x << 14) = 0xFFFFC000 != 0 so the leftmost 1-bit is at position 1.
    const s = createSketch();
    addHashed(s, "ffffffff" + "00000000".repeat(3));
    expect(s[HLL_REGISTER_COUNT - 1]).toBe(1);
    // Every other register is untouched.
    expect(s[0]).toBe(0);
  });

  it("gives the maximum rank when the tail is all zero", () => {
    // 0x00000000 folds to index 0 with an all-zero tail -> rank = (32-14)+1 = 19.
    const s = createSketch();
    addHashed(s, "0".repeat(32));
    expect(s[0]).toBe(32 - HLL_PRECISION + 1);
  });

  it("keeps only the maximum rank per register (not the latest)", () => {
    const s = createSketch();
    s[0] = 10;
    // 0x00000000 would write rank 19 to register 0 (19 > 10 -> updates).
    addHashed(s, "0".repeat(32));
    expect(s[0]).toBe(19);
    // A hash whose register-0 rank is below 19 must NOT lower it. Index 0 needs
    // the top 14 bits zero; a 1-bit low in the tail gives a small rank.
    s[0] = 19;
    addHashed(s, "00000001" + "00000000".repeat(3));
    expect(s[0]).toBe(19);
  });
});

describe("merge — strict register-wise maximum", () => {
  it("takes the larger of equal-or-different ranks, never the smaller", () => {
    const a = createSketch();
    const b = createSketch();
    a[0] = 7;
    b[0] = 7; // equal: result is 7, catches av>bv vs av>=bv boundary via other regs
    a[1] = 1;
    b[1] = 0;
    a[2] = 0;
    b[2] = 1;
    const m = merge(a, b);
    expect(m[0]).toBe(7);
    expect(m[1]).toBe(1);
    expect(m[2]).toBe(1);
  });
});

describe("error messages name the shape they rejected", () => {
  it("addHashed reports the bad hash and the byte-size mismatch", () => {
    expect(() => addHashed(createSketch(), "abc")).toThrow(/32-hex-char visitorHash/);
    expect(() => addHashed(new Uint8Array(10), "f".repeat(32))).toThrow(/16384 bytes, got 10/);
  });

  it("estimate, merge, serialize and deserialize report the size they got", () => {
    expect(() => estimate(new Uint8Array(10))).toThrow(/16384 bytes, got 10/);
    expect(() => merge(createSketch(), new Uint8Array(3))).toThrow(/16384-byte sketches, got 16384 and 3/);
    expect(() => serialize(new Uint8Array(5))).toThrow(/5-byte sketch, expected 16384/);
    expect(() => deserialize(new Uint8Array(7))).toThrow(/deserialize 7 bytes, expected 16384/);
  });
});

describe("hashForTesting", () => {
  it("returns a 32-hex-char digest that addHashed accepts", async () => {
    const { hashForTesting } = await import("./hll.js");
    const h = hashForTesting("some-visitor");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).toBe(hashForTesting("some-visitor")); // deterministic
    expect(hashForTesting("a")).not.toBe(hashForTesting("b"));
    // It is a valid synthetic visitorHash.
    const s = createSketch();
    expect(() => addHashed(s, h)).not.toThrow();
  });
});
