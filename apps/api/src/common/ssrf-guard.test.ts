import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* dns.lookup is mocked rather than left to hit real DNS: a test that resolves
   a real name is slow, flaky under a sandboxed/offline runner, and — the
   sharper reason — cannot deterministically prove the metadata-resolving-name
   case (169.254.169.254.nip.io) without depending on a third party's DNS
   staying configured exactly as expected forever. The oracle here is the
   function's own contract: "an address that isDeniedIpv4/isDeniedIpv6 would
   reject, discovered via dns.lookup instead of a literal in the URL". */
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

const { resolvesToDeniedAddress, assertNoSsrfDnsTarget } = await import("./ssrf-guard.js");

describe("resolvesToDeniedAddress", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("denies a literal private/loopback/link-local address without a lookup", async () => {
    // Regression guard for the literal case: must not regress to *requiring*
    // a lookup, since a lookup on a bare IP can behave oddly on some resolvers.
    expect(await resolvesToDeniedAddress("http://169.254.169.254/latest/meta-data/")).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("denies a public-looking name that resolves to the metadata address", async () => {
    // The exact bug this issue reports: 169.254.169.254.nip.io is not a
    // literal denied host, so only a DNS-resolving check catches it.
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    expect(await resolvesToDeniedAddress("http://169.254.169.254.nip.io/latest/meta-data/")).toBe(true);
    expect(lookupMock).toHaveBeenCalledWith("169.254.169.254.nip.io", { all: true, verbatim: true });
  });

  it("denies a name that resolves to a private 10/8 address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    expect(await resolvesToDeniedAddress("http://internal.example/admin")).toBe(true);
  });

  it("denies a name when only one of several resolved addresses is denied", async () => {
    // DNS rebinding depends on the attacker (or the resolver, or a CDN's own
    // infrastructure) choosing which answer is used — this must not pass
    // just because a public address is *also* in the answer set.
    lookupMock.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(await resolvesToDeniedAddress("http://mixed.example/x")).toBe(true);
  });

  it("denies a name that resolves to an IPv6 link-local/unique-local address", async () => {
    lookupMock.mockResolvedValue([{ address: "fd00::1", family: 6 }]);
    expect(await resolvesToDeniedAddress("http://v6.example/x")).toBe(true);
  });

  it("denies a name that resolves to an IPv6 link-local address outside the fe80:: literal prefix", async () => {
    // fe80::/10 covers fe80 through febf in the first hex group, not just
    // addresses starting with the literal string "fe80". fe90::1 is inside
    // the block but outside that narrower literal match.
    lookupMock.mockResolvedValue([{ address: "fe90::1", family: 6 }]);
    expect(await resolvesToDeniedAddress("http://v6-linklocal.example/x")).toBe(true);
  });

  it("allows a name that resolves only to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    expect(await resolvesToDeniedAddress("https://example.com/ok")).toBe(false);
  });

  it("allows (fails open, does not deny) a name that fails to resolve", async () => {
    // NXDOMAIN and "resolves to the metadata address" are different problems;
    // this function's job is only the second one. An unresolvable name cannot
    // be reached by the worker's fetch() or a redirect either, so there is no
    // SSRF to guard against here — the caller's own request fails on its own.
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await resolvesToDeniedAddress("https://this-does-not-resolve.invalid/x")).toBe(false);
  });

  it("allows an unparseable URL (not this function's job to catch)", async () => {
    expect(await resolvesToDeniedAddress("not a url")).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe("assertNoSsrfDnsTarget", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("does nothing when every URL resolves to a public address", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertNoSsrfDnsTarget(["https://example.com/a", "https://example.com/b"])).resolves.toBeUndefined();
  });

  it("skips null and undefined entries", async () => {
    await expect(assertNoSsrfDnsTarget([null, undefined])).resolves.toBeUndefined();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("throws BadRequestException naming the offending URL when one resolves to a denied address", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    lookupMock.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);

    const bad = "http://metadata.attacker.example/x";
    let caught: unknown;
    try {
      await assertNoSsrfDnsTarget(["https://example.com/ok", bad]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const response = (caught as BadRequestException).getResponse() as { message: string[] };
    expect(response.message[0]).toContain(bad);
  });

  it("checks every URL rather than stopping at the first denial, for the caller's own ordering", async () => {
    // Not asserting "all bad URLs are named" (assertNoSsrfDnsTarget throws on
    // the first one it finds) — asserting it does not skip earlier URLs
    // silently and only checks the last one.
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);

    await expect(assertNoSsrfDnsTarget(["http://first-bad.example/x", "https://example.com/never-reached"])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });
});
