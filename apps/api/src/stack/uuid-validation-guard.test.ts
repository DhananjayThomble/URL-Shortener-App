import "reflect-metadata";
import { ParseUUIDPipe } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum.js";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

/* ============================================================================
   UUID-validation parity guard (#918 — sibling of #887 / #908).

   #887 (members/reports `:id`) and #908 (analytics `linkId`) were the SAME bug
   twice: an id-bearing input took a resource id with no UUID validation, so a
   malformed value ("not-a-uuid", "") reached a Postgres `uuid` column, raised
   `invalid input syntax for type uuid` (22P02) — which PostgresErrorFilter does
   not map — and surfaced as an HTTP 500 plus an error-level log instead of a
   clean 400 naming the field.

   Spot-fixing each occurrence let the class recur. This guard ENUMERATES every
   id-bearing input across the API — controller route params AND zod request/
   query schema fields — and asserts each one is either validated as a UUID at
   the boundary (ParseUUIDPipe on the param, `.uuid()` on the zod field) or is
   on a documented allowlist of ids that are genuinely NOT UUIDs. A FUTURE
   id-bearing input added without a UUID guard and without an allowlist entry
   fails here, in the normal unit suite, before it can ship as another 500.

   ── The audit result lives in a module, not inline ────────────────────────
   The enumerated expected state — which params/fields ARE uuid-guarded and
   which ids are deliberately left as non-uuid, with the reason each — is
   committed as first-class typed data in `./uuid-id-allowlist.ts`. This test
   IMPORTS that data and asserts reality matches it, so the audit's result is
   reviewable single-source data rather than a list buried in a test body.

   ── Two axes, two mechanisms ──────────────────────────────────────────────
   Part A — ROUTE PARAMS. Reflected from every controller's decorator metadata
   (the technique `members.controller.test.ts` and `route-inventory.ts` use):
   each `@Param` carries its name in the route-args metadata, and ParseUUIDPipe
   shows up in that entry's `pipes`. Any param whose name is id-like must either
   carry the pipe or be allowlisted.

   Part B — ZOD INPUT FIELDS. For a field the audit marks `uuid` the guard
   asserts BEHAVIOURALLY — `schema.safeParse({…field: "not-a-uuid"})` must fail
   — rather than introspecting zod internals, so it stays correct across zod
   releases and proves the exact 400-not-500 property. Response schemas are out
   of scope and deliberately not listed.
   ============================================================================ */

import {
  NON_UUID_PARAM_ALLOWLIST,
  UUID_GUARDED_PARAMS,
  ZOD_ID_FIELDS,
  type ZodIdFieldSpec,
} from "./uuid-id-allowlist.js";

// ── Part A: route params ────────────────────────────────────────────────────

import { AnalyticsController } from "../analytics/analytics.controller.js";
import { AuthController } from "../auth/auth.controller.js";
import { BioPagesController } from "../bio-pages/bio-pages.controller.js";
import { ConversionsController } from "../conversions/conversions.controller.js";
import { DevelopersController } from "../developers/developers.controller.js";
import { DomainsController } from "../domains/domains.controller.js";
import { FormsController } from "../forms/forms.controller.js";
import { HealthController } from "../common/health.controller.js";
import { LinksController } from "../links/links.controller.js";
import { MembersController } from "../members/members.controller.js";
import { PublicController } from "../public/public.controller.js";
import { ReportsController } from "../reports/reports.controller.js";
import { WorkspacesController } from "../workspaces/workspaces.controller.js";

/** Every controller the app mounts — the same list `route-inventory.ts` keeps.
 *  A new controller not added here is invisible to Part A; the registry-parity
 *  guard (`route-inventory.test.ts`) is what catches a controller that exists
 *  but is not wired in, so the two guards together close that gap. */
const CONTROLLERS = [
  AnalyticsController,
  AuthController,
  BioPagesController,
  ConversionsController,
  DevelopersController,
  DomainsController,
  FormsController,
  HealthController,
  LinksController,
  MembersController,
  PublicController,
  ReportsController,
  WorkspacesController,
] as const;

interface ParamArg {
  controller: string;
  method: string;
  name: string;
  hasUuidPipe: boolean;
}

/** True for a param name that addresses a resource by id: literally `id`, or a
 *  camelCase name ending in `Id` (`linkId`, `blockId`, `workspaceId`, …). */
function isIdLike(name: string): boolean {
  return name === "id" || /Id$/.test(name);
}

function reflectParamArgs(): ParamArg[] {
  const args: ParamArg[] = [];
  for (const controller of CONTROLLERS) {
    const proto = controller.prototype as Record<string, unknown>;
    for (const method of Object.getOwnPropertyNames(proto)) {
      if (method === "constructor") continue;
      const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as
        | Record<string, { data?: unknown; pipes?: unknown[] }>
        | undefined;
      if (!meta) continue;
      for (const [key, entry] of Object.entries(meta)) {
        // key is `${paramtype}:${index}`; a custom decorator's key is a hash.
        const paramtype = Number(key.split(":")[0]);
        if (paramtype !== RouteParamtypes.PARAM) continue; // @Param only
        if (typeof entry.data !== "string") continue; // bare @Param() (whole params object) — no single id to check
        const hasUuidPipe = (entry.pipes ?? []).some(
          (p) => p === ParseUUIDPipe || p instanceof ParseUUIDPipe,
        );
        args.push({ controller: controller.name, method, name: entry.data, hasUuidPipe });
      }
    }
  }
  return args;
}

describe("Part A — every id-bearing route param is UUID-validated at the edge (#918)", () => {
  const params = reflectParamArgs();
  const uuidGuarded = new Set<string>(UUID_GUARDED_PARAMS);

  it("reflection actually found the route params (guard is not silently empty)", () => {
    // If this ever drops to ~0 the reflection broke (a Nest upgrade changed the
    // metadata shape); every assertion below would then vacuously pass. The app
    // has well over a dozen @Param uses, so a floor of 10 is safe.
    expect(params.length).toBeGreaterThanOrEqual(10);
  });

  it("no id-like param is both un-piped AND un-allowlisted", () => {
    const gaps = params
      .filter((p) => isIdLike(p.name))
      .filter((p) => !p.hasUuidPipe && !(p.name in NON_UUID_PARAM_ALLOWLIST))
      .map((p) => `${p.controller}.${p.method} @Param("${p.name}")`);
    expect(
      gaps,
      "these route params take a resource id with no ParseUUIDPipe and are not on the " +
        "NON_UUID_PARAM_ALLOWLIST (uuid-id-allowlist.ts) — a malformed id reaches Postgres as a 500. " +
        "Add ParseUUIDPipe, or, if the id is genuinely not a uuid column, allowlist it with a reason.",
    ).toEqual([]);
  });

  it("every piped id-like param is recorded in UUID_GUARDED_PARAMS (the audit data stays complete)", () => {
    const pipedButUnrecorded = params
      .filter((p) => isIdLike(p.name) && p.hasUuidPipe && !uuidGuarded.has(p.name))
      .map((p) => `${p.controller}.${p.method} @Param("${p.name}")`);
    expect(
      pipedButUnrecorded,
      "these params are UUID-piped at the edge but their name is missing from UUID_GUARDED_PARAMS " +
        "in uuid-id-allowlist.ts — add it so the committed audit data lists every guarded id.",
    ).toEqual([]);
  });

  it("an allowlisted param is never also piped (the allowlist stays honest)", () => {
    // If someone adds ParseUUIDPipe to `slug`/`domain`, the allowlist entry is
    // now a lie and should be removed — catch that rather than let the two drift.
    const contradictions = params
      .filter((p) => p.name in NON_UUID_PARAM_ALLOWLIST && p.hasUuidPipe)
      .map((p) => `${p.controller}.${p.method} @Param("${p.name}")`);
    expect(contradictions, "these params are allowlisted as non-uuid but carry ParseUUIDPipe").toEqual([]);
  });
});

// ── Part B: zod input (body / query) id fields ───────────────────────────────

import {
  AnalyticsQuery,
  RecordConversionInput,
  RefreshInput,
  UpsertBioPageInput,
} from "@snapurl/contract";

const SCHEMAS: Record<string, ZodType> = {
  AnalyticsQuery,
  RecordConversionInput,
  RefreshInput,
  UpsertBioPageInput,
};

describe("Part B — every id-bearing zod INPUT field is UUID-validated or allowlisted (#918)", () => {
  for (const f of ZOD_ID_FIELDS as readonly ZodIdFieldSpec[]) {
    const schema = SCHEMAS[f.schema]!;
    if (f.disposition.kind === "uuid") {
      it(`${f.schema}.${f.field} rejects a non-UUID (400, not a 500 from Postgres)`, () => {
        const bad = schema.safeParse({ ...f.validBase, [f.field]: "not-a-uuid" });
        expect(bad.success, `${f.schema}.${f.field} accepted "not-a-uuid" — add .uuid() to it`).toBe(false);
        // and a real uuid passes, so the failure is the id field and nothing else.
        const ok = schema.safeParse({ ...f.validBase, [f.field]: "00000000-0000-7000-8000-000000000000" });
        expect(ok.success, `${f.schema}.${f.field} rejected a REAL uuid — the guard is too strict`).toBe(true);
      });
    } else {
      it(`${f.schema}.${f.field} accepts a non-UUID string (allowlisted: ${f.disposition.reason})`, () => {
        const res = schema.safeParse({ ...f.validBase, [f.field]: "a-plain-string" });
        expect(
          res.success,
          `${f.schema}.${f.field} is allowlisted as non-uuid but rejected a plain string`,
        ).toBe(true);
      });
    }
  }

  it("every listed field names a real schema", () => {
    for (const f of ZOD_ID_FIELDS) expect(SCHEMAS[f.schema], `unknown schema ${f.schema}`).toBeDefined();
  });
});
