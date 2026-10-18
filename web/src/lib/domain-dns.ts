import type { DnsRecord, Domain } from "@snapurl/contract";

/* What the /domains setup card tells a customer to create at their DNS
   provider, derived from the Domain contract (#784).

   The card used to show the one TXT ownership record, so a customer could
   follow it exactly and still end up with a domain that verified but routed
   nowhere. Two records are needed:

     1. verify  — the TXT record (`dns`) that proves the domain is theirs;
     2. route   — the record (`routing`) that points traffic at this
                  deployment. Its value is deployment-specific, so it is read
                  from the API and never written into the web bundle.

   `routing` is absent from an API built before #784 and null when the API
   cannot work one out; either way the card then shows the ownership step on
   its own rather than inventing a target. */

export type DnsStep = {
  key: "verify" | "route";
  title: string;
  help: string;
  /** Extra guidance that only applies to this domain (e.g. root domains). */
  note?: string;
  record: DnsRecord;
};

/* Second-level labels that, under a two-letter country code, make a registrable
   domain on their own (acme.co.uk, acme.com.au). Without the public suffix list
   this is a heuristic, which is why the root-domain advice is phrased as "may
   not allow" rather than as a refusal. */
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go"]);

/** True when `domain` looks like a registrable root (acme.com, acme.co.uk), as
 *  opposed to a subdomain (go.acme.com). */
export function isLikelyApex(domain: string): boolean {
  const labels = domain.trim().toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return true;
  const tld = labels[labels.length - 1]!;
  return labels.length === 3 && tld.length === 2 && SECOND_LEVEL.has(labels[1]!);
}

export function dnsSteps(d: Domain): DnsStep[] {
  const steps: DnsStep[] = [];
  if (d.dns) {
    steps.push({
      key: "verify",
      title: "Verify ownership",
      help: "Proves the domain is yours. We look for this record when you press Check now.",
      record: d.dns,
    });
  }
  if (d.routing) {
    const rootNeedsAlias = d.routing.type === "CNAME" && isLikelyApex(d.domain);
    steps.push({
      key: "route",
      title: "Point traffic at SnapURL",
      help: "Sends visitors on this domain to SnapURL. Without it the domain verifies but links on it won't open.",
      ...(rootNeedsAlias
        ? {
            note: `${d.domain} is a root domain, and many DNS providers don't allow a CNAME on one. If yours doesn't, create an ALIAS, ANAME or "CNAME flattening" record instead, with the same value. Or use a subdomain such as go.${d.domain}.`,
          }
        : {}),
      record: d.routing,
    });
  }
  return steps;
}
