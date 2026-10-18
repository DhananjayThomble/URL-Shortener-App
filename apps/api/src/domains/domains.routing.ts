import { isIP } from "node:net";
import type { DnsRecord } from "@snapurl/contract";

/**
 * The DNS record that points a customer's domain at this deployment (#784).
 *
 * Every deploy profile sets DEFAULT_DOMAIN to the host the redirect service
 * answers on (single-node compose: DEFAULT_DOMAIN=${SHORT_DOMAIN}; helm:
 * defaultDomain; CDK: default-domain), and the shared system domain row is
 * that host. A customer domain therefore has to resolve to the same place: a
 * CNAME to it, or an A / AAAA record when the operator's short domain is a
 * bare IP address (a CNAME to an IP is not valid DNS).
 *
 * DEFAULT_DOMAIN is a Host-style value and may carry a port in dev
 * ("localhost:3002"); DNS has no ports, so only the host is returned.
 * Anything that cannot be reduced to a hostname or IP yields null — the UI
 * then shows the ownership step alone rather than a record that cannot work.
 */
export function routingRecordFor(domain: string, defaultDomain: string): DnsRecord | null {
  const target = hostOf(defaultDomain);
  if (!target) return null;
  const name = domain.trim().toLowerCase().replace(/\.$/, "");
  // A CNAME pointing at itself would resolve to nothing.
  if (target === name) return null;
  const family = isIP(target);
  const type = family === 4 ? "A" : family === 6 ? "AAAA" : "CNAME";
  return { type, name, value: target, ttl: 300 };
}

function hostOf(raw: string): string | null {
  const value = raw.trim();
  // A scheme or path means this is not a Host-style value; do not guess.
  if (!value || /[\s/@?#]/.test(value) || value.includes("://")) return null;
  let host: string;
  try {
    // URL does the port / IPv6-bracket handling; the scheme is only a carrier.
    host = new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host || null;
}
