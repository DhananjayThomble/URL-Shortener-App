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
   on a documented allowlist of ids that are genuinely NOT UUIDs (slugs, host
   names, opaque tokens, and ids that never reach a uuid column). A FUTURE
   id-bearing input added without a UUID guard and without an allowlist entry
   fails here, in the normal unit suite, before it can ship as another 500.

   ── Two axes, two mechanisms ──────────────────────────────────────────────
   Part A — ROUTE PARAMS. Reflected from every controller's decorator metadata
   (the technique `members.controller.test.ts` and `route-inventory.ts` use):
   each `@Param` carries its name in the route-args metadata, and ParseUUIDPipe
   shows up in that entry's `pipes`. Any param whose name is id-like must either
   carry the pipe or be allowlisted.

   Part B — ZOD INPUT FIELDS. Every contract schema fed to `@Body`/`@Query`
   is listed with its id-bearing fields. For a field that must be a UUID the
   guard asserts BEHAVIOURALLY — `schema.safeParse({…field: "not-a-uuid"})`
   must fail — rather than introspecting zod internals, so it stays correct
   across zod releases and proves the exact 400-not-500 property. Response
   schemas (what the API returns; the DB already produced valid uuids) are out
   of scope and deliberately not listed.
   ============================================================================ */

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

/** Route-param names that are genuinely NOT UUIDs, with the reason each one is
 *  exempt. A param here is allowed to carry no ParseUUIDPipe; anything id-like
 *  and NOT here must. */
const PARAM_ALLOWLIST: Record<string, string> = {
  // The public back-half of a short link / bio page / form. A slug is a short
  // code from a slug alphabet ([a-zA-Z0-9._-]), NOT a uuid column — forcing
  // .uuid() here would 400 every real public URL.
  slug: "public short-code / back-half, not a uuid column",
  // A custom hostname on the public bio-page routes (e.g. links.acme.com).
  domain: "custom hostname, matched against the domains table by name, not id",
};

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

  it("reflection actually found the route params (guard is not silently empty)", () => {
    // If this ever drops to ~0 the reflection broke (a Nest upgrade changed the
    // metadata shape); every assertion below would then vacuously pass. The app
    // has well over a dozen @Param uses, so a floor of 10 is safe.
    expect(params.length).toBeGreaterThanOrEqual(10);
  });

  it("no id-like param is both un-piped AND un-allowlisted", () => {
    const gaps = params
      .filter((p) => isIdLike(p.name))
      .filter((p) => !p.hasUuidPipe && !(p.name in PARAM_ALLOWLIST))
      .map((p) => `${p.controller}.${p.method} @Param("${p.name}")`);
    expect(
      gaps,
      "these route params take a resource id with no ParseUUIDPipe and are not on the " +
        "PARAM_ALLOWLIST — a malformed id reaches Postgres as a 500. Add ParseUUIDPipe, " +
        "or, if the id is genuinely not a uuid column, add it to PARAM_ALLOWLIST with a reason.",
    ).toEqual([]);
  });

  it("an allowlisted param is never also piped (the allowlist stays honest)", () => {
    // If someone adds ParseUUIDPipe to `slug`/`domain`, the allowlist entry is
    // now a lie and should be removed — catch that rather than let the two drift.
    const contradictions = params
      .filter((p) => p.name in PARAM_ALLOWLIST && p.hasUuidPipe)
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

type Disposition =
  | { kind: "uuid" } // must reject a non-uuid at the boundary
  | { kind: "allow"; reason: string }; // genuinely not a uuid column

interface ZodIdField {
  schema: string;
  field: string;
  /** A parse base that is otherwise valid, so only the id field under test
   *  decides pass/fail. The field is spread in by the assertion. */
  validBase: Record<string, unknown>;
  disposition: Disposition;
}

/* Every contract schema used by a `@Body(...)` or `@Query(...)` and its
   id-bearing fields. Response schemas are out of scope. Each `uuid` entry is
   proven to reject a malformed id; each `allow` entry documents why the id is
   not a uuid column. */
const ZOD_ID_FIELDS: ZodIdField[] = [
  {
    schema: "AnalyticsQuery",
    field: "linkId",
    validBase: { range: "30d" },
    disposition: { kind: "uuid" }, // #908 — click_daily.link_id is uuid
  },
  {
    schema: "RecordConversionInput",
    field: "linkId",
    validBase: { kind: "sale", name: "x" },
    disposition: { kind: "uuid" }, // conversions.link_id is uuid
  },
  {
    schema: "RecordConversionInput",
    field: "slug",
    validBase: { kind: "sale", name: "x" },
    disposition: { kind: "allow", reason: "public short-code, resolved to a link by slug not id" },
  },
  {
    schema: "RecordConversionInput",
    field: "externalId",
    validBase: { kind: "sale", name: "x" },
    disposition: { kind: "allow", reason: "caller's own idempotency key, an opaque string not a uuid" },
  },
  {
    schema: "RefreshInput",
    field: "workspaceId",
    validBase: { refreshToken: "t" },
    disposition: { kind: "uuid" }, // #668 — workspaces.id is uuid
  },
  {
    schema: "UpsertBioPageInput",
    field: "id",
    validBase: { domain: "snap.example", slug: "me", profile: { name: "n" } },
    disposition: { kind: "uuid" }, // #650 — bio_pages.id is uuid
  },
];

const SCHEMAS: Record<string, ZodType> = {
  AnalyticsQuery,
  RecordConversionInput,
  RefreshInput,
  UpsertBioPageInput,
};

/* Id-bearing INPUT fields that live INSIDE a nested array/object of a listed
   schema and are deliberately NOT UUID-validated, because they never reach a
   uuid `where` clause — forcing .uuid() would change observable behaviour
   (verified against the services on origin/main, #918):
     - UpsertBioPageInput.blocks[].id — matched against the page's OWN block ids
       in an in-memory Map; an unknown/malformed id is simply treated as a NEW
       block (bio-pages.service.ts). No 22P02 path.
     - CreateLinkInput/UpdateLinkInput.rules[].id (RoutingRule.id) — routing
       rules are delete-and-reinsert on every save; the client-supplied id is
       never read into a query (links.service.ts). No 22P02 path.
   They are recorded here as prose, not as executable rows, because they are
   nested and their safety is a service-level fact, not a schema-boundary one. */

describe("Part B — every id-bearing zod INPUT field is UUID-validated or allowlisted (#918)", () => {
  for (const f of ZOD_ID_FIELDS) {
    const schema = SCHEMAS[f.schema]!;
    if (f.disposition.kind === "uuid") {
      it(`${f.schema}.${f.field} rejects a non-UUID (400, not a 500 from Postgres)`, () => {
        const bad = schema.safeParse({ ...f.validBase, [f.field]: "not-a-uuid" });
        expect(bad.success, `${f.schema}.${f.field} accepted "not-a-uuid" — add .uuid() to it`).toBe(false);
        // and the base without the id field is itself valid, so the failure is
        // the id field and nothing else.
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

  it("every listed uuid field names a real schema", () => {
    for (const f of ZOD_ID_FIELDS) expect(SCHEMAS[f.schema], `unknown schema ${f.schema}`).toBeDefined();
  });
});
