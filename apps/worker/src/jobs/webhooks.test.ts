import { beforeEach, describe, expect, it, vi } from "vitest";

/* dns.lookup is mocked for the same reason apps/api/src/common/ssrf-guard.test.ts
   mocks it: a test that resolves a real name is slow, flaky under a
   sandboxed/offline runner, and cannot deterministically prove the
   metadata-resolving-name case without depending on a third party's DNS
   staying configured exactly as expected forever. */
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

const { signPayload, resolvesToPermittedAddress } = await import("./webhooks.js");

describe("signPayload", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event: "link.created", data: { id: "1" } });

  it("is stable for the same inputs", () => {
    expect(signPayload(secret, 1700000000, body)).toBe(signPayload(secret, 1700000000, body));
  });

  it("changes when the body changes", () => {
    expect(signPayload(secret, 1700000000, body)).not.toBe(signPayload(secret, 1700000000, body + " "));
  });

  it("includes the timestamp, so a captured delivery cannot be replayed later", () => {
    expect(signPayload(secret, 1700000000, body)).not.toBe(signPayload(secret, 1700000001, body));
  });

  it("changes with the secret, so one receiver cannot forge another's payload", () => {
    expect(signPayload(secret, 1700000000, body)).not.toBe(signPayload("whsec_other", 1700000000, body));
  });

  it("is a hex sha256", () => {
    expect(signPayload(secret, 1700000000, body)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resolvesToPermittedAddress", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  /* Issue #534's worker-side half: the write-time guard
     (apps/api/src/common/ssrf-guard.ts's assertNoSsrfDnsTarget) only proves a
     hostname resolved to a public address when the webhook was *created*.
     deliverWebhooks() resolves the same hostname again, potentially much
     later, immediately before its own fetch — this is the check that guards
     that second, real resolution. */

  it("permits a name that resolves only to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    expect(await resolvesToPermittedAddress("https://example.com/hook")).toBe(true);
  });

  it("denies a literal private/loopback/link-local address without a lookup", async () => {
    expect(await resolvesToPermittedAddress("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("denies a name that resolved public at write time but resolves private at delivery time", async () => {
    // The exact sequence the reviewer asked to be covered: a hostname was
    // public when assertNoSsrfDnsTarget ran at webhook-creation time
    // (apps/api/src/common/ssrf-guard.ts), and the same hostname now resolves
    // to a denied address by the time deliverWebhooks() is about to fetch it —
    // DNS rebinding, or a record that changed in between. The write-time
    // result must not be trusted at delivery time: this function re-resolves
    // independently and must deny based on what the name resolves to *now*,
    // not what it resolved to when the webhook was created.
    lookupMock.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    expect(await resolvesToPermittedAddress("http://rebinding.example/hook")).toBe(false);
  });

  it("denies (fails closed) a name that fails to resolve", async () => {
    // The opposite of assertNoSsrfDnsTarget's own resolvesToDeniedAddress,
    // which fails *open* on a lookup error for the write-time "don't reject a
    // typo" trade-off. At the actual connection point there is no such
    // trade-off: an unresolvable endpoint cannot be delivered to, so this
    // must not proceed either.
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await resolvesToPermittedAddress("https://this-does-not-resolve.invalid/hook")).toBe(false);
  });

  it("denies (fails closed) an unparseable URL", async () => {
    expect(await resolvesToPermittedAddress("not a url")).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("denies a name when only one of several resolved addresses is denied", async () => {
    lookupMock.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(await resolvesToPermittedAddress("http://mixed.example/hook")).toBe(false);
  });

  it("denies (fails closed) a lookup that returns no addresses", async () => {
    lookupMock.mockResolvedValue([]);
    expect(await resolvesToPermittedAddress("http://empty-answer.example/hook")).toBe(false);
  });
});
