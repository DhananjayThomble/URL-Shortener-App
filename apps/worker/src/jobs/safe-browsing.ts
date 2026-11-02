/* ============================================================
   #994 — worker-side Google Safe Browsing scanning.

   The rescan job (link-scanning.ts) and the reputation watch both need to ask
   Safe Browsing whether a URL is listed. The API already has a
   SafeBrowsingService, but apps/worker does NOT depend on apps/api (it would
   pull Nest and the whole HTTP app into a background Lambda), so the small
   amount of scanning logic the worker needs lives here.

   It is deliberately a plain function, not a class, taking the API key, so a
   test injects a stub scanner and NO LIVE NETWORK CALL is ever made in CI.
   Production passes `scanUrl` bound to the real key resolved at cold start.

   The verdicts match the API's SafeBrowsingService exactly ("clean" |
   "flagged" | "pending") so a link rescanned by the worker reads the same way
   as one scanned by the API on create. With no key the worker returns "clean"
   WITHOUT calling out — same honest-but-permissive posture the API documents.
   ============================================================ */

export type SafeBrowsingVerdict = "clean" | "flagged" | "pending";

/** A function that returns a Safe Browsing verdict for one URL. The real one is
 *  `makeSafeBrowsingScanner`; tests pass their own. */
export type UrlScanner = (url: string) => Promise<SafeBrowsingVerdict>;

const ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";

/**
 * Build the real Safe Browsing scanner, closing over the API key.
 *
 * With no key the scanner returns "clean" without a network call, matching the
 * API's documented no-key behaviour. A non-OK response or a thrown error (an
 * outage, a timeout) returns "pending", NOT "clean": the difference between
 * "checked and safe" and "we couldn't check" stays visible, and a pending link
 * is simply re-checked on the next pass.
 */
export function makeSafeBrowsingScanner(apiKey: string | undefined, timeoutMs = 4000): UrlScanner {
  return async (url: string): Promise<SafeBrowsingVerdict> => {
    if (!apiKey) return "clean";
    try {
      const response = await fetch(`${ENDPOINT}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "snapurl-worker", clientVersion: "2.0.0" },
          threatInfo: {
            threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }],
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return "pending";
      const body = (await response.json()) as { matches?: unknown[] };
      return body.matches?.length ? "flagged" : "clean";
    } catch {
      return "pending";
    }
  };
}
