import { Inject, Injectable, Logger } from "@nestjs/common";
import type { SafeBrowsingStatus } from "@snapurl/contract";
import { ENV, type Env } from "../config/env.js";

export interface ScanResult {
  status: SafeBrowsingStatus;
  checkedAt: Date;
}

/* ============================================================
   Google Safe Browsing.

   ASSUMPTION WORTH FLAGGING (docs/DECISIONS.md A10):

   Without GOOGLE_SAFE_BROWSING_API_KEY this returns "clean" for
   every URL. That is not the same as "scanned and found safe",
   but the UI cannot tell the difference — it renders "Scanned &
   safe · no cookies set" and "Checked against Google Safe
   Browsing" either way.

   So with no key configured the product makes a claim it is not
   backing up. Two honest options: set the key, or change the copy
   to say scanning is off. A warning is logged at boot so this
   cannot be discovered by a customer first.
   ============================================================ */

const ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";

@Injectable()
export class SafeBrowsingService {
  private readonly logger = new Logger(SafeBrowsingService.name);
  private warned = false;

  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return Boolean(this.env.GOOGLE_SAFE_BROWSING_API_KEY);
  }

  async check(url: string): Promise<ScanResult> {
    const checkedAt = new Date();

    if (!this.enabled) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          "GOOGLE_SAFE_BROWSING_API_KEY is not set — links are marked clean without being scanned, " +
            "while the UI claims they were checked. Set the key or soften the copy.",
        );
      }
      return { status: "clean", checkedAt };
    }

    try {
      const response = await fetch(`${ENDPOINT}?key=${this.env.GOOGLE_SAFE_BROWSING_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "snapurl", clientVersion: "2.0.0" },
          threatInfo: {
            threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }],
          },
        }),
        signal: AbortSignal.timeout(4000),
      });

      if (!response.ok) {
        this.logger.warn({ status: response.status }, "Safe Browsing check failed");
        return { status: "pending", checkedAt };
      }

      const body = (await response.json()) as { matches?: unknown[] };
      return { status: body.matches?.length ? "flagged" : "clean", checkedAt };
    } catch (err) {
      /* A scanner outage must not stop someone creating a link. The status
         becomes "pending" rather than "clean" so the difference between
         "checked and safe" and "we couldn't check" stays visible. */
      this.logger.warn({ err }, "Safe Browsing check errored");
      return { status: "pending", checkedAt };
    }
  }
}
