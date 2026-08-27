import { describe, expect, it } from "vitest";
import { isForeignKeyViolation, isUniqueViolation, postgresErrorCode } from "./postgres-error.filter.js";
import { SPARKLINE_DAYS, buildSparkline, decodeCursor, encodeCursor } from "../links/links.mapper.js";
import { initialsOf } from "../auth/auth.service.js";

describe("postgresErrorCode", () => {
  /* This is the exact regression that turned a handled 409 into a 500:
     Drizzle 0.44 wraps the driver error, so the code is not at the top level. */
  it("finds the code on a bare driver error", () => {
    expect(postgresErrorCode({ code: "23505" })).toBe("23505");
  });

  it("finds the code through Drizzle's wrapper", () => {
    const wrapped = Object.assign(new Error("Failed query"), { cause: { code: "23505" } });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("finds the code several levels down", () => {
    const deep = { cause: { cause: { cause: { code: "23503" } } } };
    expect(isForeignKeyViolation(deep)).toBe(true);
  });

  it("gives up rather than looping forever on a cycle", () => {
    const a: Record<string, unknown> = {};
    a.cause = a;
    expect(postgresErrorCode(a)).toBeNull();
  });

  it("ignores things that are not five-digit SQLSTATE codes", () => {
    expect(postgresErrorCode({ code: "ENOTFOUND" })).toBeNull();
    expect(postgresErrorCode({ code: 23505 })).toBeNull();
  });

  it("returns null for ordinary errors", () => {
    expect(postgresErrorCode(new Error("just an error"))).toBeNull();
    expect(postgresErrorCode(null)).toBeNull();
  });
});

describe("buildSparkline", () => {
  /* G8 — the contract said number[]. A ragged array makes the chart render
     inconsistent widths between rows in the same table. */
  const today = new Date("2026-06-15T00:00:00Z");

  it("always returns exactly 30 entries", () => {
    expect(buildSparkline([], today)).toHaveLength(SPARKLINE_DAYS);
    expect(buildSparkline([{ day: "2026-06-15", clicks: 9 }], today)).toHaveLength(SPARKLINE_DAYS);
  });

  it("zero-fills days with no clicks", () => {
    expect(buildSparkline([], today).every((n) => n === 0)).toBe(true);
  });

  it("puts today last, so the newest day is on the right", () => {
    const out = buildSparkline([{ day: "2026-06-15", clicks: 42 }], today);
    expect(out[out.length - 1]).toBe(42);
  });

  it("puts the oldest day first", () => {
    const out = buildSparkline([{ day: "2026-05-17", clicks: 7 }], today);
    expect(out[0]).toBe(7);
  });

  it("ignores days outside the window", () => {
    expect(buildSparkline([{ day: "2020-01-01", clicks: 999 }], today).every((n) => n === 0)).toBe(true);
  });
});

describe("cursor pagination", () => {
  /* G4 — keyset, not OFFSET: links are created continuously, and with OFFSET a
     row inserted mid-pagination shifts everything after it. */
  it("round-trips a date and id", () => {
    const at = new Date("2026-06-15T10:30:00.000Z");
    const decoded = decodeCursor(encodeCursor(at, "01a04409-e12b-7157-a3d8-75e2e993255d"));
    expect(decoded?.id).toBe("01a04409-e12b-7157-a3d8-75e2e993255d");
    expect(decoded?.createdAt.toISOString()).toBe(at.toISOString());
  });

  it("is opaque, so nobody builds a client that increments it", () => {
    const cursor = encodeCursor(new Date("2026-06-15T10:30:00Z"), "abc");
    expect(cursor).not.toContain("2026");
    expect(cursor).not.toContain("abc");
  });

  it("returns null for junk instead of throwing", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(Buffer.from("no-separator").toString("base64url"))).toBeNull();
  });

  it("returns null for an unparseable date", () => {
    expect(decodeCursor(Buffer.from("nonsense|abc").toString("base64url"))).toBeNull();
  });
});

describe("initialsOf", () => {
  it("takes the first and last initial", () => {
    expect(initialsOf("Dhananjay Thomble")).toBe("DT");
  });

  it("takes two letters from a single name", () => {
    expect(initialsOf("Demo")).toBe("DE");
  });

  it("skips the middle name", () => {
    expect(initialsOf("Ada Byron Lovelace")).toBe("AL");
  });

  it("copes with extra whitespace", () => {
    expect(initialsOf("  Grace   Hopper  ")).toBe("GH");
  });

  it("does not throw on an empty name", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});
