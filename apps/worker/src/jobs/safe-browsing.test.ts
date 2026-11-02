import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSafeBrowsingScanner } from "./safe-browsing.js";

/* #994 — the worker-side Safe Browsing scanner. fetch is stubbed, so no live
   network call happens; the point under test is the verdict mapping. */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeSafeBrowsingScanner", () => {
  it("returns 'clean' with no key and never calls fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const scan = makeSafeBrowsingScanner(undefined);
    expect(await scan("https://example.com")).toBe("clean");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 'flagged' when Safe Browsing reports a match", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ matches: [{ threatType: "SOCIAL_ENGINEERING" }] }), { status: 200 }),
    );
    const scan = makeSafeBrowsingScanner("key");
    expect(await scan("https://phish.example")).toBe("flagged");
  });

  it("returns 'clean' when there are no matches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const scan = makeSafeBrowsingScanner("key");
    expect(await scan("https://good.example")).toBe("clean");
  });

  it("returns 'pending' on a non-OK response (the difference between unsafe and uncheckable stays visible)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 503 }));
    const scan = makeSafeBrowsingScanner("key");
    expect(await scan("https://x.example")).toBe("pending");
  });

  it("returns 'pending' when fetch throws (timeout / outage)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("aborted"));
    const scan = makeSafeBrowsingScanner("key");
    expect(await scan("https://x.example")).toBe("pending");
  });
});
