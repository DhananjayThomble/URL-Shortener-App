import { describe, expect, it } from "vitest";
import { SubmitReportInput, UpdateAbuseReportInput } from "./report.js";

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
});
