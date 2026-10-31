/* ============================================================================
   UUID-validation audit — the enumerated id surface, as first-class data (#918).

   This module is the committed OUTPUT of the #918 audit (the sibling of #887
   and #908): every id-bearing input across the API, each with a verdict. The
   parity guard `uuid-validation-guard.test.ts` IMPORTS this data and asserts
   against it, so the audit result is reviewable single-source data rather than
   a list inlined in a test. When a future id-bearing input is added, the author
   records its verdict HERE and the guard enforces it; a new unguarded id that is
   neither validated nor listed fails CI.

   Two axes, matching the two places an id enters the API:
     - PARAM_* — controller route params (`@Param("id", ParseUUIDPipe)` etc.)
     - ZOD_ID_FIELDS — request/query zod schema fields fed to @Body/@Query.

   The guard proves these are real (reflection for params, behavioural
   `safeParse` for zod fields); this module is the expected-state oracle it
   compares against. Response schemas (what the API returns; the DB already
   produced valid uuids) are deliberately out of scope.
   ============================================================================ */

/** Route-param names that address a resource by its UUID id and therefore MUST
 *  carry `ParseUUIDPipe` at the controller edge. A malformed value on one of
 *  these would otherwise reach a Postgres `uuid` column and surface as a 500
 *  (22P02) instead of a clean 400 — the #887 bug. The guard asserts every one
 *  of these is piped, and that no OTHER id-like param exists unlisted/unpiped. */
export const UUID_GUARDED_PARAMS = ["id", "blockId"] as const;

/** Route-param names that are genuinely NOT uuid columns, with the reason each
 *  is exempt from `ParseUUIDPipe`. Forcing `.uuid()` on these would reject real
 *  requests. The guard asserts an allowlisted param is never ALSO piped, so the
 *  allowlist cannot silently drift out of agreement with the controllers. */
export const NON_UUID_PARAM_ALLOWLIST: Readonly<Record<string, string>> = {
  // The public back-half of a short link / bio page / form: a short code from
  // the slug alphabet ([a-zA-Z0-9._-]), not a uuid column.
  slug: "public short-code / back-half, resolved by slug not id — not a uuid column",
  // A custom hostname on the public bio-page routes (e.g. links.acme.com),
  // matched against the domains table by name.
  domain: "custom hostname, matched by name — not a uuid column",
};

/** Disposition of a zod INPUT field that carries (or looks like it carries) a
 *  resource id. `uuid` = must reject a non-uuid at the boundary; `allow` = the
 *  value is genuinely not a uuid column, with the reason it is left unguarded. */
export type ZodIdDisposition = { kind: "uuid" } | { kind: "allow"; reason: string };

export interface ZodIdFieldSpec {
  /** Exported name of the contract schema (as re-exported from @snapurl/contract). */
  readonly schema: string;
  /** The id-bearing field under test. */
  readonly field: string;
  /** An otherwise-valid parse base, so only `field` decides pass/fail. */
  readonly validBase: Readonly<Record<string, unknown>>;
  readonly disposition: ZodIdDisposition;
}

/** Every id-bearing field on a contract schema used by `@Body(...)`/`@Query(...)`.
 *  `uuid` entries are proven to reject a non-uuid (400-not-500); `allow` entries
 *  document why the id is not a uuid column. */
export const ZOD_ID_FIELDS: readonly ZodIdFieldSpec[] = [
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
] as const;

/** Id-bearing INPUT fields nested inside an array/object of a listed schema that
 *  are deliberately NOT uuid-validated, because they never reach a uuid `where`
 *  clause — so forcing `.uuid()` would change observable behaviour, not just
 *  turn a 500 into a 400 (verified against the services on origin/main, #918).
 *  Recorded as prose because their safety is a service-level fact, not a
 *  schema-boundary one the guard can assert behaviourally. */
export const NESTED_NON_UUID_IDS: readonly { readonly location: string; readonly reason: string }[] = [
  {
    location: "UpsertBioPageInput.blocks[].id",
    reason:
      "matched against the page's OWN block ids in an in-memory Map; an unknown/malformed id is " +
      "treated as a NEW block (bio-pages.service.ts). No uuid where-clause, so no 22P02 path.",
  },
  {
    location: "CreateLinkInput/UpdateLinkInput.rules[].id (RoutingRule.id)",
    reason:
      "routing rules are delete-and-reinsert on every save; the client-supplied id is never read " +
      "into a query (links.service.ts). No uuid where-clause, so no 22P02 path.",
  },
] as const;
