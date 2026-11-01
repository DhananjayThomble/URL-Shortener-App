/* ============================================================
   #973 — SES email figures, behind a port.

   Sends / bounces / complaints live in SES and CloudWatch, not the database.
   Unlike every other figure on the platform-analytics page they cannot be read
   from a summary table, have no per-workspace decomposition, and cannot be
   seeded into an integration test. So they sit behind this port, and the
   default binding returns "not available" — which is the honest answer
   everywhere no SES metric source is wired (every test environment, and
   production until the read-only IAM grant on the API role lands).

   A CloudWatch adapter would implement this interface over
   GetMetricData (AWS/SES Send, Bounce, Complaint) and the module would bind it
   instead. That adapter plus its IAM grant is a documented follow-up; defining
   the port now means adding the data later changes no contract and no caller.
   ============================================================ */

/** Raw SES counts for a window, or nulls when no source is configured. */
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

/**
 * The default reader: no SES source, so every figure is unavailable.
 *
 * This is deliberately the binding in every environment today. It lets the
 * platform-analytics view render honestly — "email metrics are not configured"
 * — rather than fabricating a zero that reads as "no email was ever sent". The
 * CloudWatch adapter replaces this binding without touching the service.
 */
export class UnavailableEmailStatsReader implements EmailStatsReader {
  async stats(_start: string, _end: string): Promise<EmailStats> {
    return { available: false, sends: null, bounces: null, complaints: null };
  }
}
