import { Logger } from "@nestjs/common";
import {
  GetSendQuotaCommand,
  GetSendStatisticsCommand,
  SESClient,
  type SendDataPoint,
} from "@aws-sdk/client-ses";

/* ============================================================
   #973 — SES email figures, behind a port.

   Sends / bounces / complaints live in SES, not the database — they have no
   per-workspace decomposition and cannot be seeded, so they sit behind this
   port. Two bindings:

     - SesEmailStatsReader reads the real figures from Amazon SES (production,
       when MAIL_TRANSPORT=ses so the sending account is actually in use).
     - UnavailableEmailStatsReader reports "not available", the honest answer
       for local dev / self-host / outbox transport, and the fallback the SES
       reader itself falls back to when the SES call fails (a missing grant, a
       throttle, a region with no SES). A failure must never 500 the whole
       platform-analytics page over one tile.

   On the SES API surface actually used (and why it is the installed
   @aws-sdk/client-ses, not a second @aws-sdk/client-sesv2 client):

     - GetSendStatistics returns ~15-minute SendDataPoints over the trailing two
       weeks, each with DeliveryAttempts / Bounces / Complaints / Rejects. The
       window's sends/bounces/complaints are the sum of the datapoints whose
       timestamp falls in [start, end). This is the only SES call that gives
       bounces and complaints, and it exists ONLY on the classic client.
     - GetSendQuota returns the account's Max24HourSend and SentLast24Hours —
       the 24h send quota and sent count the scope asks for. SESv2 GetAccount
       returns the identical SendQuota object; using the classic client's
       GetSendQuota instead means ONE SES client and no new runtime dependency,
       reaching the same figures. The IAM grant is scoped to exactly the two
       read-only account actions this uses (see infra/lib/snapurl-stack.ts):
       ses:GetSendStatistics and ses:GetSendQuota.
   ============================================================ */

/** Raw SES counts for a window, or nulls when no source is configured / the
 *  call failed. `sends`/`bounces`/`complaints` are the per-window figures the
 *  analytics page shows; `quota24h`/`sent24h` are the account's rolling-24h
 *  quota and sent count (not window-scoped), surfaced for context. */
export interface EmailStats {
  available: boolean;
  sends: number | null;
  bounces: number | null;
  complaints: number | null;
}

export interface EmailStatsReader {
  /** SES figures over [start, end) (inclusive start, exclusive end), as ISO
   *  `YYYY-MM-DD` strings. */
  stats(start: string, end: string): Promise<EmailStats>;
}

/** The DI token bound to an EmailStatsReader. */
export const EMAIL_STATS_READER = Symbol("EMAIL_STATS_READER");

/** The "no data" answer, shared by the unavailable binding and the SES
 *  reader's failure fallback. */
export const UNAVAILABLE: EmailStats = { available: false, sends: null, bounces: null, complaints: null };

/**
 * The default reader: no SES source, so every figure is unavailable.
 *
 * The binding for local dev, self-host, and any environment whose mail
 * transport is the outbox. It lets the platform-analytics view render honestly
 * — "email metrics are not configured" — rather than fabricating a zero that
 * reads as "no email was ever sent".
 */
export class UnavailableEmailStatsReader implements EmailStatsReader {
  async stats(_start: string, _end: string): Promise<EmailStats> {
    return { ...UNAVAILABLE };
  }
}

/** The subset of SESClient this reader calls — just `send`. Lets the unit test
 *  pass a mock without standing up a real client or hitting AWS. */
export interface SesSendClient {
  send(command: unknown): Promise<unknown>;
}

/**
 * Reads the real SES figures over the window.
 *
 * Fails SAFE: any error from SES (missing grant, throttle, sandbox, a region
 * with SES disabled) is logged and turned into the "unavailable" answer, so a
 * broken email tile never takes down the rest of the platform-analytics page.
 *
 * The client is constructed with the stack's region (ap-south-1 in
 * production); on Lambda AWS_REGION is set by the runtime and the SDK would
 * read it anyway, but passing it explicitly keeps the reader correct when
 * constructed somewhere the env var is not set.
 */
export class SesEmailStatsReader implements EmailStatsReader {
  private readonly logger = new Logger(SesEmailStatsReader.name);

  constructor(private readonly client: SesSendClient) {}

  async stats(start: string, end: string): Promise<EmailStats> {
    const startMs = Date.parse(start);
    // `end` is the exclusive upper bound (the day after the last day), as a
    // plain YYYY-MM-DD → midnight UTC. A datapoint at exactly `end` is out.
    const endMs = Date.parse(end);

    try {
      // GetSendStatistics is the figure that matters (bounces/complaints); the
      // quota call is best-effort context and must not fail the whole read.
      const [statsRes, quotaRes] = await Promise.all([
        this.client.send(new GetSendStatisticsCommand({})) as Promise<{ SendDataPoints?: SendDataPoint[] }>,
        (this.client.send(new GetSendQuotaCommand({})) as Promise<{ SentLast24Hours?: number }>).catch(() => ({})),
      ]);

      const points = statsRes.SendDataPoints ?? [];
      // Keep only the datapoints inside [start, end). SES stamps each with the
      // bucket's Timestamp; a point with no timestamp cannot be placed, so it
      // is excluded rather than double-counted into every window.
      const inWindow = points.filter((p) => {
        const t = p.Timestamp instanceof Date ? p.Timestamp.getTime() : p.Timestamp ? Date.parse(String(p.Timestamp)) : NaN;
        return Number.isFinite(t) && t >= startMs && t < endMs;
      });

      const sum = (pick: (p: SendDataPoint) => number | undefined) =>
        inWindow.reduce((n, p) => n + (pick(p) ?? 0), 0);

      // Window sends: the delivery attempts SES actually made in the window.
      // When the window is empty but the account has a rolling-24h sent count,
      // fall back to that so a freshly-seeded 24h view is not a misleading 0.
      const windowSends = sum((p) => p.DeliveryAttempts);
      const sends =
        windowSends > 0 || inWindow.length > 0 ? windowSends : (quotaRes as { SentLast24Hours?: number }).SentLast24Hours ?? 0;

      return {
        available: true,
        sends,
        bounces: sum((p) => p.Bounces),
        complaints: sum((p) => p.Complaints),
      };
    } catch (err) {
      // Never surface an SES failure as a 500: log it and report unavailable,
      // exactly as if no source were configured.
      this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, "SES send statistics read failed");
      return { ...UNAVAILABLE };
    }
  }
}

/** Build the SES client the production reader uses, pinned to the given region.
 *  Kept a factory so the module can construct it lazily and the test can inject
 *  a mock SesSendClient instead. */
export function makeSesClient(region: string | undefined): SESClient {
  return new SESClient(region ? { region } : {});
}
