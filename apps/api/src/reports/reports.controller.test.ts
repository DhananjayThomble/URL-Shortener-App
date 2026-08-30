import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { SubmitReportInput } from "@snapurl/contract";
import { PublicController } from "../public/public.controller.js";

/* The abuse-report intake is an unauthenticated write, so its per-route rate
   limit is not optional decoration — it is the only thing bounding spam and DB
   bloat (#291). @nestjs/throttler stores the limit as metadata on the method
   under 'THROTTLER:LIMIT' + '<name>'. Removing the @Throttle would silently
   fall back to the global budget; this asserts it is present and bounded. */
describe("PublicController.report throttle", () => {
  it("carries a bounded per-minute @Throttle on the report route", () => {
    const method = PublicController.prototype.report;
    const limit = Reflect.getMetadata("THROTTLER:LIMIT" + "default", method);
    const ttl = Reflect.getMetadata("THROTTLER:TTL" + "default", method);

    expect(limit).toBe(10);
    expect(ttl).toBe(60_000);
  });
});

/* A plain validation check so the shared body shape is exercised without a DB. */
describe("SubmitReportInput at the intake", () => {
  it("accepts a real report and rejects an empty reason", () => {
    expect(SubmitReportInput.safeParse({ reason: "This link is a phishing page." }).success).toBe(true);
    expect(SubmitReportInput.safeParse({ reason: "" }).success).toBe(false);
  });
});
