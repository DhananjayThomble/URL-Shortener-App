import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCKED_REASON_TERMS, BLOCKED_VISITS_CAPTION, BLOCKED_VISITS_LABEL } from "./blocked-visits";

/* #767 — `totals.blocked` is sum(click_daily.blocked): every gate rejection the
   redirect records, not just Safe Browsing flags. The tile copy must describe
   all of them, and must not drift when the redirect gains a reason. */

describe("blocked visits tile copy", () => {
  it("does not claim the count is only unsafe / Safe Browsing blocks", () => {
    expect(BLOCKED_VISITS_LABEL).toBe("Blocked visits");
    expect(BLOCKED_VISITS_LABEL.toLowerCase()).not.toContain("unsafe");
    expect(BLOCKED_VISITS_CAPTION).not.toMatch(/safe browsing/i);
  });

  it("names every rejection reason in the caption", () => {
    for (const term of Object.values(BLOCKED_REASON_TERMS)) {
      expect(BLOCKED_VISITS_CAPTION.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  it("reads as one natural-language list", () => {
    expect(BLOCKED_VISITS_CAPTION).toBe("Expired, scheduled, over limit, archived or unsafe");
  });

  it("covers exactly the reasons the redirect can record (drift guard)", () => {
    const src = readFileSync(resolve(__dirname, "../../../apps/redirect/src/main.ts"), "utf8");
    const sig = /function gateFor\([^)]*\):\s*([^{]+)\{/.exec(src);
    expect(sig, "gateFor signature not found in apps/redirect/src/main.ts").not.toBeNull();
    const reasons = [...sig![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).sort();
    expect(reasons.length).toBeGreaterThan(0);
    expect(Object.keys(BLOCKED_REASON_TERMS).sort()).toEqual(reasons);
  });
});
