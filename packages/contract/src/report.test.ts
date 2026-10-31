import { describe, expect, it } from "vitest";
import {
  AbuseReport,
  AbuseReportStatus,
  SubmitReportInput,
  SubmitReportResult,
  UpdateAbuseReportInput,
} from "./report.js";

/* Issue #291: the abuse-report intake is unauthenticated, so the body shape is
   the only thing standing between a real report and junk. The slug is not in
   the body — it comes from the route — so these tests only cover reason and
   reporterContact. */

describe("SubmitReportInput", () => {
  it("accepts a valid reason", () => {
    expect(SubmitReportInput.safeParse({ reason: "This is a phishing page." }).success).toBe(true);
  });

  it("rejects an empty or too-short reason", () => {
    expect(SubmitReportInput.safeParse({ reason: "" }).success).toBe(false);
    expect(SubmitReportInput.safeParse({ reason: "ab" }).success).toBe(false);
  });

  it("accepts a valid reporterContact email", () => {
    expect(
      SubmitReportInput.safeParse({ reason: "phishing", reporterContact: "victim@example.com" }).success,
    ).toBe(true);
  });

  it("rejects a non-email reporterContact", () => {
    expect(SubmitReportInput.safeParse({ reason: "phishing", reporterContact: "not-an-email" }).success).toBe(
      false,
    );
  });

  it("allows reporterContact omitted or empty", () => {
    expect(SubmitReportInput.safeParse({ reason: "phishing" }).success).toBe(true);
    expect(SubmitReportInput.safeParse({ reason: "phishing", reporterContact: "" }).success).toBe(true);
  });
});

describe("UpdateAbuseReportInput", () => {
  it("accepts a status change", () => {
    expect(UpdateAbuseReportInput.safeParse({ status: "actioned" }).success).toBe(true);
  });

  it("accepts a flagLink toggle", () => {
    expect(UpdateAbuseReportInput.safeParse({ flagLink: true }).success).toBe(true);
  });

  /* #895: the shape is load-bearing — an empty-object shape would strip and
     accept anything. Pin that each field is actually validated. */
  it("validates the status enum rather than accepting any string", () => {
    expect(UpdateAbuseReportInput.safeParse({ status: "nonsense" }).success).toBe(false);
    const ok = UpdateAbuseReportInput.parse({ status: "reviewed" });
    expect(ok.status).toBe("reviewed"); // a {} shape would drop this key
  });

  it("validates flagLink as a boolean, not any value", () => {
    expect(UpdateAbuseReportInput.safeParse({ flagLink: "yes" }).success).toBe(false);
    expect(UpdateAbuseReportInput.parse({ flagLink: true }).flagLink).toBe(true);
  });
});

describe("AbuseReportStatus enum", () => {
  it("accepts exactly its four values and rejects others", () => {
    for (const s of ["open", "reviewed", "dismissed", "actioned"]) {
      expect(AbuseReportStatus.safeParse(s).success).toBe(true);
    }
    expect(AbuseReportStatus.safeParse("closed").success).toBe(false);
    expect(AbuseReportStatus.safeParse("").success).toBe(false);
  });
});

describe("AbuseReport shape", () => {
  const valid = {
    id: "r1",
    slug: "abc",
    reason: "phishing",
    reporterContact: null,
    status: "open" as const,
    linkId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  it("accepts a well-formed operator-side report and keeps its fields", () => {
    const parsed = AbuseReport.parse(valid);
    expect(parsed.id).toBe("r1");
    expect(parsed.status).toBe("open"); // a {} shape would drop every key
  });

  it("requires each field with its declared type (kills the shape → {} mutant)", () => {
    expect(AbuseReport.safeParse({ ...valid, status: "garbage" }).success).toBe(false);
    expect(AbuseReport.safeParse({ ...valid, id: 123 }).success).toBe(false);
    const { id: _id, ...noId } = valid;
    expect(AbuseReport.safeParse(noId).success).toBe(false);
    // reporterContact and linkId are nullable strings, not free-form.
    expect(AbuseReport.safeParse({ ...valid, reporterContact: 5 }).success).toBe(false);
    expect(AbuseReport.safeParse({ ...valid, linkId: 5 }).success).toBe(false);
  });
});

describe("SubmitReportResult shape", () => {
  it("requires an ok boolean (kills the shape → {} mutant)", () => {
    expect(SubmitReportResult.parse({ ok: true }).ok).toBe(true);
    expect(SubmitReportResult.safeParse({ ok: "yes" }).success).toBe(false);
    expect(SubmitReportResult.safeParse({}).success).toBe(false);
  });
});
