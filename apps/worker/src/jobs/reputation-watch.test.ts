import { describe, expect, it, vi } from "vitest";
import { reputationWatch, type DomainBlocklistLookup, type ReputationHit } from "./link-scanning.js";
import type { UrlScanner } from "./safe-browsing.js";

/* #994 point 5 — the domain reputation watch. Both lookups are injected, so no
   live network call happens. The behaviour under test: alert on a hit from
   either source, do not alert when both are clean, and never fire a false
   alarm when a source throws. */

const clean: UrlScanner = async () => "clean";
const flagged: UrlScanner = async () => "flagged";
const notListed: DomainBlocklistLookup = async () => false;
const listed: DomainBlocklistLookup = async () => true;

describe("reputationWatch", () => {
  it("does not alert when every source is clean", async () => {
    const alert = vi.fn();
    const result = await reputationWatch({
      hosts: ["snapurl.in", "snap.to"],
      scan: clean,
      domainBlocklist: notListed,
      alert,
    });
    expect(result.checked).toBe(2);
    expect(result.hits).toHaveLength(0);
    expect(alert).not.toHaveBeenCalled();
  });

  it("alerts on a Safe Browsing hit", async () => {
    const alert = vi.fn();
    const result = await reputationWatch({ hosts: ["snapurl.in"], scan: flagged, domainBlocklist: notListed, alert });
    expect(result.hits).toEqual([{ host: "snapurl.in", source: "safe-browsing" }]);
    expect(alert).toHaveBeenCalledWith({ host: "snapurl.in", source: "safe-browsing" });
  });

  it("alerts on a domain-blocklist (DBL) hit", async () => {
    const alert = vi.fn();
    const result = await reputationWatch({ hosts: ["snapurl.in"], scan: clean, domainBlocklist: listed, alert });
    expect(result.hits).toEqual([{ host: "snapurl.in", source: "domain-blocklist" }]);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("alerts once per source when both list the host", async () => {
    const alert = vi.fn();
    const result = await reputationWatch({ hosts: ["snapurl.in"], scan: flagged, domainBlocklist: listed, alert });
    const sources = result.hits.map((h: ReputationHit) => h.source).sort();
    expect(sources).toEqual(["domain-blocklist", "safe-browsing"]);
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it("does not fire a false alarm when a source throws (outage)", async () => {
    const alert = vi.fn();
    const throwingScan: UrlScanner = async () => {
      throw new Error("safe browsing down");
    };
    const throwingDbl: DomainBlocklistLookup = async () => {
      throw new Error("dns timeout");
    };
    const result = await reputationWatch({
      hosts: ["snapurl.in"],
      scan: throwingScan,
      domainBlocklist: throwingDbl,
      alert,
    });
    expect(result.hits).toHaveLength(0);
    expect(alert).not.toHaveBeenCalled();
  });
});
