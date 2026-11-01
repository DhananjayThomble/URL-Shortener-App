import { describe, expect, it, vi } from "vitest";
import { GetSendQuotaCommand, GetSendStatisticsCommand } from "@aws-sdk/client-ses";
import {
  SesEmailStatsReader,
  UnavailableEmailStatsReader,
  type SesSendClient,
} from "./email-stats.reader.js";

/* ============================================================
   #973 — the SES email-stats reader, against a MOCKED SES client (no AWS,
   no network). Proves:
     - the window filter sums only the SendDataPoints whose timestamp is in
       [start, end), with bounces/complaints read from the same points;
     - GetSendStatistics is the figure source and GetSendQuota is best-effort;
     - any SES error fails SAFE to "unavailable" rather than throwing;
     - the unavailable binding is a clean all-null answer.
   ============================================================ */

/** A SendDataPoint at `daysAgo` days before `now`. */
function point(now: Date, daysAgo: number, attempts: number, bounces: number, complaints: number) {
  const ts = new Date(now);
  ts.setUTCDate(ts.getUTCDate() - daysAgo);
  return { Timestamp: ts, DeliveryAttempts: attempts, Bounces: bounces, Complaints: complaints, Rejects: 0 };
}

/** A mock client that answers each command type from a script, and records
 *  which commands it was asked to send. */
function mockClient(script: {
  stats?: unknown;
  quota?: unknown;
  statsError?: Error;
}): { client: SesSendClient; sent: string[] } {
  const sent: string[] = [];
  const client: SesSendClient = {
    send: vi.fn(async (command: unknown) => {
      if (command instanceof GetSendStatisticsCommand) {
        sent.push("GetSendStatistics");
        if (script.statsError) throw script.statsError;
        return script.stats ?? { SendDataPoints: [] };
      }
      if (command instanceof GetSendQuotaCommand) {
        sent.push("GetSendQuota");
        return script.quota ?? {};
      }
      throw new Error("unexpected command");
    }),
  };
  return { client, sent };
}

// A fixed "now" so the window math is deterministic. The reader only reads the
// start/end strings it is given, so these drive the filter directly.
const START = "2026-06-01";
const END = "2026-06-08"; // exclusive upper bound (7-day window: Jun 1..Jun 7)
const NOW = new Date("2026-06-07T12:00:00Z"); // inside the window, for the point() helper

describe("SesEmailStatsReader", () => {
  it("sums sends/bounces/complaints from the datapoints inside the window", async () => {
    const { client } = mockClient({
      stats: {
        SendDataPoints: [
          point(NOW, 0, 100, 2, 1), // today — in window
          point(NOW, 3, 50, 1, 0), // 3d ago — in window
          point(NOW, 30, 999, 99, 99), // 30d ago — OUT of window
        ],
      },
      quota: { SentLast24Hours: 123 },
    });
    const reader = new SesEmailStatsReader(client);
    const res = await reader.stats(START, END);
    expect(res.available).toBe(true);
    expect(res.sends).toBe(150); // 100 + 50; the 30d-ago 999 excluded
    expect(res.bounces).toBe(3); // 2 + 1
    expect(res.complaints).toBe(1); // 1 + 0
  });

  it("excludes a datapoint with no usable timestamp", async () => {
    const { client } = mockClient({
      stats: { SendDataPoints: [point(NOW, 1, 10, 1, 1), { DeliveryAttempts: 5, Bounces: 5, Complaints: 5 }] },
    });
    const res = await new SesEmailStatsReader(client).stats(START, END);
    expect(res.sends).toBe(10); // only the timestamped point
    expect(res.bounces).toBe(1);
  });

  it("falls back to SentLast24Hours only when the window has no datapoints", async () => {
    const { client } = mockClient({ stats: { SendDataPoints: [] }, quota: { SentLast24Hours: 42 } });
    const res = await new SesEmailStatsReader(client).stats(START, END);
    expect(res.available).toBe(true);
    expect(res.sends).toBe(42); // empty window -> the rolling-24h sent count
    expect(res.bounces).toBe(0);
  });

  it("queries GetSendStatistics (and GetSendQuota) — statistics is the real source", async () => {
    const { client, sent } = mockClient({ stats: { SendDataPoints: [] } });
    await new SesEmailStatsReader(client).stats(START, END);
    expect(sent).toContain("GetSendStatistics");
    expect(sent).toContain("GetSendQuota");
  });

  it("still returns available figures when the quota call fails (quota is best-effort)", async () => {
    const client: SesSendClient = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof GetSendStatisticsCommand) return { SendDataPoints: [point(NOW, 0, 7, 0, 0)] };
        throw new Error("quota denied");
      }),
    };
    const res = await new SesEmailStatsReader(client).stats(START, END);
    expect(res.available).toBe(true);
    expect(res.sends).toBe(7);
  });

  it("fails SAFE to unavailable when GetSendStatistics errors (no throw, no 500)", async () => {
    const { client } = mockClient({ statsError: new Error("AccessDenied: ses:GetSendStatistics") });
    const res = await new SesEmailStatsReader(client).stats(START, END);
    expect(res).toEqual({ available: false, sends: null, bounces: null, complaints: null });
  });
});

describe("UnavailableEmailStatsReader", () => {
  it("is a clean all-null answer", async () => {
    const res = await new UnavailableEmailStatsReader().stats(START, END);
    expect(res).toEqual({ available: false, sends: null, bounces: null, complaints: null });
  });
});
