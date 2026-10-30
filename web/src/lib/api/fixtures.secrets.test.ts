import { afterEach, describe, expect, it, vi } from "vitest";
import { CreatedApiKey, CreatedWebhook } from "@snapurl/contract";
import { fixtureRequest } from "./fixtures";

/* Code scanning (js/insecure-randomness): fixture-mode API keys and webhook
   secrets are shown to the user as real-looking secrets, so they must come
   from the CSPRNG rather than Math.random(). Shape is unchanged. */

afterEach(() => vi.restoreAllMocks());

describe("fixture secrets", () => {
  it("do not depend on Math.random()", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const key = await fixtureRequest("/api-keys", CreatedApiKey, {
      method: "POST",
      body: { name: "ci", scopes: ["links:read"] },
    });
    const hook = await fixtureRequest("/webhooks", CreatedWebhook, {
      method: "POST",
      body: { endpoint: "https://example.com/h", events: ["link.created"] },
    });
    expect(key.key).toMatch(/^sk_live_[0-9a-f]{16}$/);
    expect(hook.secret).toMatch(/^whsec_[0-9a-f]{16}$/);
    // A pinned Math.random would make Math.random-derived secrets identical every time.
    const again = await fixtureRequest("/api-keys", CreatedApiKey, {
      method: "POST",
      body: { name: "ci", scopes: ["links:read"] },
    });
    expect(again.key).not.toBe(key.key);
  });

  it("differ between calls", async () => {
    const mk = () =>
      fixtureRequest("/api-keys", CreatedApiKey, { method: "POST", body: { name: "a", scopes: [] } });
    expect((await mk()).key).not.toBe((await mk()).key);
  });
});
