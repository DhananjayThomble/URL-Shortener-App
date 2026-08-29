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
