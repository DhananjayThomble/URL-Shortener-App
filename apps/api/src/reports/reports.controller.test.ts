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


/* ============================================================
   PATCH /reports/:id parses its id as a UUID at the edge, the same as
   LinksController and DomainsController. Without it, PATCH /reports/not-a-uuid
   sent the raw string into a `where id = $1` query against the `abuse_reports`
   uuid column; Postgres raised 22P02, PostgresErrorFilter had no mapping, and a
   malformed request surfaced as a 500 plus an error-level log (#887).

   Pure metadata/pipe assertions, so this runs in the non-DB unit suite.
   ============================================================ */
import { BadRequestException, ParseUUIDPipe } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { ReportsController } from "./reports.controller.js";

function hasParseUuidPipe(methodName: keyof ReportsController): boolean {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, ReportsController, methodName as string) ?? {};
  const entries = Object.values(meta) as Array<{ data?: unknown; pipes?: unknown[] }>;
  return entries.some(
    (entry) =>
      entry.data === "id" &&
      (entry.pipes ?? []).some((pipe) => pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe),
  );
}

describe("ReportsController :id route rejects a non-UUID before the DB", () => {
  it("update parses its :id with ParseUUIDPipe", () => {
    expect(hasParseUuidPipe("update")).toBe(true);
  });

  it("ParseUUIDPipe turns a malformed id into a 400", async () => {
    const pipe = new ParseUUIDPipe();
    const metadata = { type: "param" as const, data: "id" };
    for (const bad of ["not-a-uuid", "1' or '1'='1", "\u0000", ""]) {
      await expect(pipe.transform(bad, metadata)).rejects.toBeInstanceOf(BadRequestException);
    }
    const id = "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b";
    await expect(pipe.transform(id, metadata)).resolves.toBe(id);
  });
});
