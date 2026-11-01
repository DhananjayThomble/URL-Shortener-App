import { describe, expect, it } from "vitest";
import {
  AdminAuditPage,
  AdminAuditQuery,
  AdminAuditRow,
  AdminBacklog,
  AdminBacklogs,
  AdminMe,
  AdminRetryResult,
  AdminServiceHealth,
  AdminServiceState,
  AdminServiceStatus,
} from "./admin.js";

/* #974 — behavioural tests for the admin system-health contract shapes.

   These assert the PARSE behaviour a user of the schema sees, which is what
   kills the non-string mutants Stryker introduces in this file (the bounds,
   .int(), coercion, nullability and defaults on AdminAuditQuery especially).
   Per packages/contract/stryker.config.json the StringLiteral mutator is
   excluded here, so enum member spellings and .describe() text are not asserted
   literally — only behaviour is. */

describe("AdminMe (#968)", () => {
  it("accepts a confirmed admin and pins isPlatformAdmin true", () => {
    const parsed = AdminMe.parse({ id: "u1", name: "A", email: "a@x.com", isPlatformAdmin: true });
    expect(parsed.isPlatformAdmin).toBe(true);
    // literal(true): false must be rejected (kills the literal flip / widening).
    expect(AdminMe.safeParse({ id: "u1", name: "A", email: "a@x.com", isPlatformAdmin: false }).success).toBe(false);
  });
});

describe("AdminServiceState / AdminServiceStatus / AdminServiceHealth", () => {
  it("accepts the three states and rejects an unknown one", () => {
    expect(AdminServiceState.safeParse("ok").success).toBe(true);
    expect(AdminServiceState.safeParse("degraded").success).toBe(true);
    expect(AdminServiceState.safeParse("down").success).toBe(true);
    expect(AdminServiceState.safeParse("unknown").success).toBe(false);
  });

  it("requires every field of a service status", () => {
    const parsed = AdminServiceStatus.parse({ name: "api", state: "ok", detail: "up" });
    expect(parsed).toEqual({ name: "api", state: "ok", detail: "up" });
    // Each required field dropped must fail (kills the shape → {} mutant).
    expect(AdminServiceStatus.safeParse({ state: "ok", detail: "up" }).success).toBe(false);
    expect(AdminServiceStatus.safeParse({ name: "api", detail: "up" }).success).toBe(false);
    expect(AdminServiceStatus.safeParse({ name: "api", state: "ok" }).success).toBe(false);
    // state is constrained to the enum.
    expect(AdminServiceStatus.safeParse({ name: "api", state: "nope", detail: "up" }).success).toBe(false);
  });

  it("wraps the status array under services", () => {
    const ok = AdminServiceHealth.parse({ services: [{ name: "api", state: "ok", detail: "up" }] });
    expect(ok.services).toHaveLength(1);
    // The array element is itself an AdminServiceStatus, so a bad element fails.
    expect(AdminServiceHealth.safeParse({ services: [{ name: "api" }] }).success).toBe(false);
    // services must be present.
    expect(AdminServiceHealth.safeParse({}).success).toBe(false);
  });
});

describe("AdminBacklog / AdminBacklogs", () => {
  it("requires integer pending and stuck counts", () => {
    const parsed = AdminBacklog.parse({ name: "projection_outbox", pending: 4, stuck: 2 });
    expect(parsed).toEqual({ name: "projection_outbox", pending: 4, stuck: 2 });
    // .int() must reject a fractional count (kills the .int() drop mutant).
    expect(AdminBacklog.safeParse({ name: "x", pending: 1.5, stuck: 0 }).success).toBe(false);
    expect(AdminBacklog.safeParse({ name: "x", pending: 0, stuck: 2.5 }).success).toBe(false);
    // A non-number is rejected.
    expect(AdminBacklog.safeParse({ name: "x", pending: "4", stuck: 0 }).success).toBe(false);
    // Each field is required.
    expect(AdminBacklog.safeParse({ name: "x", pending: 1 }).success).toBe(false);
  });

  it("wraps the backlog array under backlogs", () => {
    const ok = AdminBacklogs.parse({ backlogs: [{ name: "job_leases", pending: 1, stuck: 0 }] });
    expect(ok.backlogs[0]!.name).toBe("job_leases");
    expect(AdminBacklogs.safeParse({}).success).toBe(false);
    expect(AdminBacklogs.safeParse({ backlogs: [{ name: "x", pending: 1 }] }).success).toBe(false);
  });
});

describe("AdminRetryResult", () => {
  it("requires an integer retried count", () => {
    expect(AdminRetryResult.parse({ retried: 3 }).retried).toBe(3);
    expect(AdminRetryResult.parse({ retried: 0 }).retried).toBe(0);
    expect(AdminRetryResult.safeParse({ retried: 2.5 }).success).toBe(false); // kills .int() drop
    expect(AdminRetryResult.safeParse({}).success).toBe(false); // retried required
    expect(AdminRetryResult.safeParse({ retried: "3" }).success).toBe(false);
  });
});

describe("AdminAuditRow / AdminAuditPage", () => {
  it("requires the row fields and allows null target fields", () => {
    const full = AdminAuditRow.parse({
      id: "a1",
      at: "2026-11-01T00:00:00.000Z",
      actor: "admin@x.com",
      action: "admin.job_lease.release",
      targetType: "job_lease",
      targetId: "nm",
    });
    expect(full.targetType).toBe("job_lease");
    // targetType/targetId are .nullable(): null is accepted (kills nullable drop).
    const nulls = AdminAuditRow.parse({
      id: "a2",
      at: "2026-11-01T00:00:00.000Z",
      actor: "admin@x.com",
      action: "admin.projection_outbox.retry",
      targetType: null,
      targetId: null,
    });
    expect(nulls.targetType).toBeNull();
    expect(nulls.targetId).toBeNull();
    // but the field key must still be present / a string|null, not undefined.
    expect(
      AdminAuditRow.safeParse({ id: "a3", at: "x", actor: "y", action: "z", targetId: null }).success,
    ).toBe(false); // targetType missing
    // non-nullable required fields cannot be null.
    expect(
      AdminAuditRow.safeParse({ id: null, at: "x", actor: "y", action: "z", targetType: null, targetId: null }).success,
    ).toBe(false);
  });

  it("pages rows with a boolean hasMore", () => {
    const page = AdminAuditPage.parse({ rows: [], hasMore: false });
    expect(page.hasMore).toBe(false);
    // hasMore is a boolean, not coerced from a truthy value.
    expect(AdminAuditPage.safeParse({ rows: [], hasMore: "no" }).success).toBe(false);
    expect(AdminAuditPage.safeParse({ rows: [] }).success).toBe(false); // hasMore required
    expect(AdminAuditPage.safeParse({ hasMore: true }).success).toBe(false); // rows required
  });
});

describe("AdminAuditQuery — filters, coercion, bounds and defaults", () => {
  it("defaults limit to 50 and offset to 0 on an empty query", () => {
    const parsed = AdminAuditQuery.parse({});
    expect(parsed.limit).toBe(50); // kills .default(50)
    expect(parsed.offset).toBe(0); // kills .default(0)
    // The optional filters are absent, not defaulted to anything.
    expect(parsed.action).toBeUndefined();
    expect(parsed.actor).toBeUndefined();
    expect(parsed.targetId).toBeUndefined();
    expect(parsed.after).toBeUndefined();
    expect(parsed.before).toBeUndefined();
  });

  it("coerces string limit/offset to numbers (query strings arrive as strings)", () => {
    const parsed = AdminAuditQuery.parse({ limit: "25", offset: "10" });
    expect(parsed.limit).toBe(25); // kills z.coerce.number() → z.number()
    expect(parsed.offset).toBe(10);
  });

  it("enforces the limit bounds 1..200", () => {
    expect(AdminAuditQuery.safeParse({ limit: 0 }).success).toBe(false); // kills .min(1)
    expect(AdminAuditQuery.safeParse({ limit: 1 }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ limit: 200 }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ limit: 201 }).success).toBe(false); // kills .max(200)
    // non-integer limit rejected.
    expect(AdminAuditQuery.safeParse({ limit: 10.5 }).success).toBe(false); // kills .int()
  });

  it("enforces offset >= 0 and integer", () => {
    expect(AdminAuditQuery.safeParse({ offset: -1 }).success).toBe(false); // kills .min(0)
    expect(AdminAuditQuery.safeParse({ offset: 0 }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ offset: 2.5 }).success).toBe(false); // kills .int()
  });

  it("bounds the action filter length 1..80", () => {
    expect(AdminAuditQuery.safeParse({ action: "" }).success).toBe(false); // kills .min(1)
    expect(AdminAuditQuery.safeParse({ action: "a".repeat(80) }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ action: "a".repeat(81) }).success).toBe(false); // kills .max(80)
  });

  it("bounds the actor filter length 1..255", () => {
    expect(AdminAuditQuery.safeParse({ actor: "" }).success).toBe(false); // kills .min(1)
    expect(AdminAuditQuery.safeParse({ actor: "a".repeat(255) }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ actor: "a".repeat(256) }).success).toBe(false); // kills .max(255)
  });

  it("bounds the targetId filter length 1..255", () => {
    expect(AdminAuditQuery.safeParse({ targetId: "" }).success).toBe(false); // kills .min(1)
    expect(AdminAuditQuery.safeParse({ targetId: "a".repeat(255) }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ targetId: "a".repeat(256) }).success).toBe(false); // kills .max(255)
  });

  it("requires after/before to be ISO-8601 datetimes", () => {
    expect(AdminAuditQuery.safeParse({ after: "2026-11-01T00:00:00.000Z" }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ after: "2026-11-01" }).success).toBe(false); // kills .datetime() drop
    expect(AdminAuditQuery.safeParse({ before: "2026-11-01T00:00:00.000Z" }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ before: "not-a-date" }).success).toBe(false);
  });

  it("accepts a fully-specified query", () => {
    const parsed = AdminAuditQuery.parse({
      action: "admin.webhook_deliveries.retry",
      actor: "admin@x.com",
      targetId: "webhook_deliveries",
      after: "2026-10-01T00:00:00.000Z",
      before: "2026-11-01T00:00:00.000Z",
      limit: 10,
      offset: 20,
    });
    expect(parsed.action).toBe("admin.webhook_deliveries.retry");
    expect(parsed.limit).toBe(10);
    expect(parsed.offset).toBe(20);
  });
});
