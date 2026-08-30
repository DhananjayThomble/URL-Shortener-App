import type { RoutingRule } from "@snapurl/contract";

/* ============================================================
   The DynamoDB link projection — item shapes and a pure mapper.

   The AWS profile serves the redirect hot path from a DynamoDB
   projection of the link config, not from Postgres: one HTTP-based
   key lookup, no connection pool to warm. The worker drains the
   projection_outbox and writes these items; the redirect reads
   them back. Both apps import THIS module so the item shape and
   the Date<->stored-form conversion have exactly one definition —
   a projected field and the field the reader revives cannot drift.

   This module is deliberately SDK-free: it is pure data mapping,
   no @aws-sdk import, so it lives in @snapurl/database (which both
   apps already depend on) and the AWS SDK stays confined to the
   redirect (reader) and worker (writer) that actually talk to
   DynamoDB.

   Single table, keyed by domain:
     - a LINK item per (domain, slug):
         PK = 'd#' + normaliseHost(domain)
         SK = 's#' + slug.toLowerCase()
       carrying every ResolvedLink field, plus the link `id` as a
       top-level `linkId` attribute so a delete (which only knows
       the link id — see below) can find it via a GSI.
     - a DOMAIN-META item per domain:
         PK = 'd#' + normaliseHost(domain)
         SK = DOMAIN_META_SK ('d#meta')
       carrying {id, rootRedirect, notFoundRedirect} for the
       root/not-found redirect lookups.

   The delete-key gap: the API's enqueueProjection stores only
   {linkId, operation} in the outbox and deletes the links row in
   the same transaction, so at drain time a `delete` cannot read
   the (domain, slug) needed to build the LINK item's key from
   Postgres. The projection table therefore carries a Global
   Secondary Index on the `linkId` attribute (LINK_ID_GSI), so the
   writer's remove(linkId) queries the GSI for the item(s) with
   that id and deletes them. Upserts do not need this — the link
   row still exists for an upsert, so the writer reads (domain,
   slug) straight from Postgres.
   ============================================================ */

/** Fixed sort key for the per-domain meta item (root / not-found redirect). */
export const DOMAIN_META_SK = "d#meta";

/** The attribute the delete GSI is keyed on. Present on every LINK item. */
export const LINK_ID_ATTR = "linkId";

/** The name of the Global Secondary Index keyed on {@link LINK_ID_ATTR}. */
export const LINK_ID_GSI = "linkId-index";

/** The shape one LINK item resolves to — identical to the redirect's
 *  ResolvedLink. Defined here (rather than imported from the redirect) so this
 *  package stays free of an app dependency; the two are structurally the same
 *  and the redirect's LinkResolver returns exactly this. */
export interface ProjectedLink {
  id: string;
  workspaceId: string;
  destination: string;
  redirectType: "301" | "302" | "307";
  rules: RoutingRule[];
  expiresAt: Date | null;
  expiresTo: string | null;
  activatesAt: Date | null;
  scheduledTo: string | null;
  clickLimit: number | null;
  clicks: number;
  hasPassword: boolean;
  forwardQuery: boolean;
  deepLink: boolean;
  hideReferrer: boolean;
  publicPreview: boolean;
  archived: boolean;
  safeBrowsingStatus: string;
  utm: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
  } | null;
}

/** The shape one DOMAIN-META item resolves to. */
export interface ProjectedDomain {
  id: string;
  rootRedirect: string | null;
  notFoundRedirect: string | null;
}

/** The stored form of a LINK item. Date fields are ISO strings (or null) so
 *  the mapper — not the caller — owns the Date<->string conversion, exactly as
 *  CachingLinkResolver does when it revives a cached link. */
export interface LinkItem {
  PK: string;
  SK: string;
  /** The link id, top-level, so the delete GSI can be keyed on it. */
  linkId: string;
  workspaceId: string;
  destination: string;
  redirectType: string;
  rules: RoutingRule[];
  expiresAt: string | null;
  expiresTo: string | null;
  activatesAt: string | null;
  scheduledTo: string | null;
  clickLimit: number | null;
  clicks: number;
  hasPassword: boolean;
  forwardQuery: boolean;
  deepLink: boolean;
  hideReferrer: boolean;
  publicPreview: boolean;
  archived: boolean;
  safeBrowsingStatus: string;
  utm: ProjectedLink["utm"];
}

/** The stored form of a DOMAIN-META item. */
export interface DomainItem {
  PK: string;
  SK: string;
  id: string;
  rootRedirect: string | null;
  notFoundRedirect: string | null;
}

/** Strips nothing but case/whitespace: the SAME normalisation the Postgres
 *  resolver's host lookup uses, so a link created against "SNAP.TO" resolves
 *  from a request whose Host header is "snap.to". This is the single source of
 *  truth; the redirect re-exports it from its resolver so both key-builders and
 *  the Postgres lookup agree. */
export function normaliseHost(host: string): string {
  return host.toLowerCase().trim();
}

/** PK for every item on a domain (both LINK and DOMAIN-META). */
export function domainPk(host: string): string {
  return `d#${normaliseHost(host)}`;
}

/** SK for a LINK item, matching the Postgres slug normalisation (lowercased). */
export function linkSk(slug: string): string {
  return `s#${slug.toLowerCase()}`;
}

/** The full DynamoDB Key for a LINK item. */
export function linkKey(host: string, slug: string): { PK: string; SK: string } {
  return { PK: domainPk(host), SK: linkSk(slug) };
}

/** The full DynamoDB Key for a DOMAIN-META item. */
export function domainMetaKey(host: string): { PK: string; SK: string } {
  return { PK: domainPk(host), SK: DOMAIN_META_SK };
}

/** ProjectedLink -> stored LinkItem. Dates become ISO strings (null preserved),
 *  everything else is copied verbatim. */
export function toLinkItem(link: ProjectedLink, host: string, slug: string): LinkItem {
  return {
    PK: domainPk(host),
    SK: linkSk(slug),
    linkId: link.id,
    workspaceId: link.workspaceId,
    destination: link.destination,
    redirectType: link.redirectType,
    rules: link.rules,
    expiresAt: link.expiresAt === null ? null : link.expiresAt.toISOString(),
    expiresTo: link.expiresTo,
    activatesAt: link.activatesAt === null ? null : link.activatesAt.toISOString(),
    scheduledTo: link.scheduledTo,
    clickLimit: link.clickLimit,
    /* Point-in-time click count, read from link_counters at projection time.
       This matches gateFor()'s "the count is the last rollup's, not a live
       one" overshoot semantics and is identical to the Postgres path, so the
       DynamoDB and Postgres resolvers cannot disagree on the click-limit gate
       beyond the rollup lag both already carry. */
    clicks: link.clicks,
    hasPassword: link.hasPassword,
    forwardQuery: link.forwardQuery,
    deepLink: link.deepLink,
    hideReferrer: link.hideReferrer,
    publicPreview: link.publicPreview,
    archived: link.archived,
    safeBrowsingStatus: link.safeBrowsingStatus,
    utm: link.utm ?? null,
  };
}

/** Stored LinkItem -> ProjectedLink. Revives the Date fields (null preserved)
 *  exactly like CachingLinkResolver.reviveLink, so the redirect sees a real
 *  Date on expiresAt/activatesAt and gateFor()'s time comparisons work. */
export function fromLinkItem(item: LinkItem): ProjectedLink {
  return {
    id: item.linkId,
    workspaceId: item.workspaceId,
    destination: item.destination,
    redirectType: item.redirectType as ProjectedLink["redirectType"],
    rules: item.rules ?? [],
    expiresAt: item.expiresAt === null ? null : new Date(item.expiresAt),
    expiresTo: item.expiresTo,
    activatesAt: item.activatesAt === null ? null : new Date(item.activatesAt),
    scheduledTo: item.scheduledTo,
    clickLimit: item.clickLimit,
    clicks: item.clicks,
    hasPassword: item.hasPassword,
    forwardQuery: item.forwardQuery,
    deepLink: item.deepLink,
    hideReferrer: item.hideReferrer,
    publicPreview: item.publicPreview,
    archived: item.archived,
    safeBrowsingStatus: item.safeBrowsingStatus,
    utm: item.utm ?? null,
  };
}

/* ============================================================
   The CloudFront + KeyValueStore edge fast path (#289).

   For a plain, unconditional link — no password, no routing
   rules, no click limit, not expired, not scheduled, not
   archived, safe-browsing clean — the redirect can be answered at
   the edge from a CloudFront KeyValueStore, with no Lambda
   invocation, no DynamoDB read and no VPC round-trip. The same
   outbox drain that writes the DynamoDB projection writes one KVS
   entry per edge-eligible link; anything the edge cannot answer
   falls through to the Lambda, which stays authoritative.

   These three functions are the single source of truth shared by
   the worker's KVS writer and the CloudFront Function's reader:
   the key format, the eligibility rule and the stored value must
   match byte-for-byte on both sides, so they are defined ONCE here
   (SDK-free, in the package both apps import) rather than
   duplicated. The CloudFront Function cannot import this module
   (its `cloudfront` runtime is not Node), so it re-implements
   kvsKey inline — the shared test in infra/functions guards the
   two against drift.
   ============================================================ */

/** The KeyValueStore key for a link, derived from the viewer host and slug.
 *
 *  Format: `<normalised-host>/<lowercased-slug>` — e.g. `snap.to/foo`.
 *
 *  Deliberately built from only what a CloudFront Function can reproduce with
 *  no extra normalisation: the host lowercased+trimmed (normaliseHost) and the
 *  slug lowercased, joined by a single '/'. The Function derives the identical
 *  key from `request.headers.host.value` and the single path segment, so a
 *  write here and a read there resolve the same entry. Do NOT change this
 *  format without changing the Function (and the drift-guard test) in lockstep. */
export function kvsKey(host: string, slug: string): string {
  return `${normaliseHost(host)}/${slug.toLowerCase()}`;
}

/** Whether a link may be served from the edge fast path.
 *
 *  Edge-eligible iff it is a plain unconditional redirect the edge can answer
 *  byte-for-byte the way the Lambda would. That means:
 *
 *  - No BLOCKING gate: no password, no routing rules, no click limit, and no
 *    time gate at all (neither expiry nor activation — the edge cannot reliably
 *    evaluate time), not archived, and safe-browsing clean. This is the
 *    click-accounting decision (option c): the edge only serves links where
 *    per-click accuracy does not matter.
 *
 *  - No TRANSFORM the Lambda applies on the happy path and the edge cannot
 *    reproduce: the redirect Lambda runs buildDestination (which merges the
 *    forwarded query when `forwardQuery` and injects stored `utm`), buildDeepLink
 *    (when `deepLink`), and sets `Referrer-Policy: no-referrer` (when
 *    `hideReferrer`). The edge returns only the raw stored destination, so any of
 *    `forwardQuery`, a non-null `utm`, `deepLink`, or `hideReferrer` would make
 *    the edge response materially wrong. Keep those links on the Lambda.
 *
 *  - Not a 301: cacheHeadersFor("301") honours the author's chosen permanence
 *    with `public, max-age=300`, whereas the edge answers every hit with
 *    `no-store`. Rather than special-case the Function, only 302/307 links are
 *    edge-served; a 301 stays on the Lambda so its permanence is honoured.
 *
 *  Everything else falls through to the Lambda, which remains authoritative for
 *  click accounting and every conditional gate. */
export function isEdgeEligible(link: ProjectedLink): boolean {
  return (
    link.hasPassword === false &&
    link.rules.length === 0 &&
    link.clickLimit == null &&
    link.expiresAt == null &&
    link.activatesAt == null &&
    link.archived === false &&
    link.safeBrowsingStatus === "clean" &&
    link.forwardQuery === false &&
    link.utm == null &&
    link.deepLink === false &&
    link.hideReferrer === false &&
    link.redirectType !== "301"
  );
}

/** The KeyValueStore value for a link: the minimum the edge needs to answer a
 *  redirect. JSON `{ destination, redirectType }` — a URL plus a 3-char code is
 *  far under the 1 KB per-value limit (and 5 MB per-store), so no truncation
 *  guard is needed. The CloudFront Function JSON.parses this and reads exactly
 *  these two fields. */
export function kvsValue(link: ProjectedLink): string {
  return JSON.stringify({ destination: link.destination, redirectType: link.redirectType });
}

/** ProjectedDomain -> stored DomainItem. */
export function toDomainItem(host: string, domain: ProjectedDomain): DomainItem {
  return {
    PK: domainPk(host),
    SK: DOMAIN_META_SK,
    id: domain.id,
    rootRedirect: domain.rootRedirect,
    notFoundRedirect: domain.notFoundRedirect,
  };
}

/** Stored DomainItem -> ProjectedDomain. */
export function fromDomainItem(item: DomainItem): ProjectedDomain {
  return {
    id: item.id,
    rootRedirect: item.rootRedirect,
    notFoundRedirect: item.notFoundRedirect,
  };
}
