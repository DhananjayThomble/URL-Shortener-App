import type { Domain } from "@snapurl/contract";
import { formatDate } from "./utils";

/* What the /domains table says about a domain, derived from the Domain contract
   rather than guessed in JSX (#782).

   The page used to show "Pending" for any ssl that was not (active AND had a
   renewal date). The built-in shared domain is created live + ssl "active" with
   no renewal date (the platform manages its certificate, there is nothing to
   renew per workspace), so it read Status Live / SSL Pending — and a "failed"
   status was printed as "Verifying DNS". Each state now maps to its own label. */

export type Tone = "good" | "warn" | "bad";
export type StateView = { label: string; tone: Tone };

/** The shared SnapURL domain belongs to every workspace; the API refuses to
 *  disconnect it (409), so the UI must not offer the action. */
export function canDisconnectDomain(d: Domain): boolean {
  return d.shared !== true;
}

export function domainStatusView(d: Domain): StateView {
  switch (d.status) {
    case "live":
      return { label: "Live", tone: "good" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    default:
      return { label: "Verifying DNS", tone: "warn" };
  }
}

export function domainSslView(d: Domain): StateView {
  if (d.ssl === "failed") return { label: "Failed", tone: "bad" };
  if (d.ssl === "pending") return { label: "Pending", tone: "warn" };
  // ssl is active from here on.
  if (d.shared === true) return { label: "Managed by SnapURL", tone: "good" };
  if (d.sslRenewsAt && !Number.isNaN(new Date(d.sslRenewsAt).getTime())) {
    return { label: `Auto · renews ${formatDate(d.sslRenewsAt)}`, tone: "good" };
  }
  return { label: "Active", tone: "good" };
}
