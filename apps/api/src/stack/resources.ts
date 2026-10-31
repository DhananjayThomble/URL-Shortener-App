/* Per-workspace resources for the access-matrix suite (spec: api-stack-tests,
 * design §4 "Resources", M2–M5).
 *
 * `principals.ts` (#888) seeds the nine PRINCIPALS but not the resources every
 * `{id}` route needs a real target for. This module fills that gap: created
 * over HTTP as the workspace owner, so creation goes through the real
 * controller→service code paths (the layer most likely to be wrong for authz),
 * one of each resource kind in a workspace:
 *
 *   link, form, domain (pending), bio-page, webhook, api-key, member (invited),
 *   abuse report (via the @Public report intake).
 *
 * Two shapes are exported:
 *   - `seedResources(owner)` — the shared, read-safe targets. A GET/own-only
 *     probe reads these; a denied-but-non-mutating probe (a 401/403/404 that
 *     changes nothing) may target them too.
 *   - `freshLinkId` / `freshFormId` / `freshDomainId` / … — a brand-new target
 *     per call, for the M4 no-side-effect assertion: a denied mutating request
 *     must leave its target byte-for-byte unchanged, so each such case gets its
 *     OWN resource that nothing else touches.
 *
 * Test support only: excluded from the production build (apps/api/tsconfig.json),
 * imported only by the stack suites.
 */
import { randomUUID } from "node:crypto";
import type { Principal } from "./principals.js";

/** The system short domain every workspace can mint links on. Mirrors the
 *  staging compose default (`DEFAULT_DOMAIN=localhost:3002`); a stack run that
 *  overrides it must pass STACK_DEFAULT_DOMAIN so link creation targets the
 *  real system domain rather than a host the workspace does not own. */
export const DEFAULT_DOMAIN = process.env.STACK_DEFAULT_DOMAIN ?? "localhost:3002";

export interface SeededResources {
  linkId: string;
  formId: string;
  /** A pending (unverified) domain owned by this workspace. */
  domainId: string;
  bioPageId: string;
  webhookId: string;
  apiKeyId: string;
  /** An invited (not yet active) membership of this workspace. */
  memberId: string;
  /** The slug of a link, so public `/public/links/{slug}` routes have a real
   *  target. */
  linkSlug: string;
  /** The slug of a LIVE bio page, so `/public/bio-pages/{slug}` resolves (a
   *  draft bio page 404s on the public route — the oracle observed a live one). */
  bioSlug: string;
}

function headers(owner: Principal, extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(owner.authorization ? { authorization: owner.authorization } : {}),
    ...extra,
  };
}

async function readError(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => "");
  throw new Error(`seedResources: ${what} failed — ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`);
}

async function post<T>(apiUrl: string, owner: Principal, path: string, body: unknown, what: string): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: headers(owner),
    body: JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) await readError(res, what);
  return (await res.json()) as T;
}

async function put<T>(apiUrl: string, owner: Principal, path: string, body: unknown, what: string): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, {
    method: "PUT",
    headers: headers(owner),
    body: JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) await readError(res, what);
  return (await res.json()) as T;
}

/** A unique, DNS-looking domain name this workspace can add (pending state). */
function freshDomainName(): string {
  return `stack-${randomUUID().slice(0, 8)}.example.com`;
}

/* ── single-resource creators (also the building blocks of seedResources) ── */

export async function freshLink(apiUrl: string, owner: Principal): Promise<{ id: string; slug: string }> {
  const slug = `am-${randomUUID().slice(0, 12)}`;
  const link = await post<{ id: string; slug: string }>(
    apiUrl,
    owner,
    "/links",
    { destination: "https://example.com/access-matrix", domain: DEFAULT_DOMAIN, slug },
    "create link",
  );
  return { id: link.id, slug: link.slug ?? slug };
}

export async function freshForm(apiUrl: string, owner: Principal): Promise<{ id: string }> {
  const form = await post<{ id: string }>(
    apiUrl,
    owner,
    "/forms",
    { title: `access-matrix form ${randomUUID().slice(0, 8)}`, status: "draft", fields: [] },
    "create form",
  );
  return { id: form.id };
}

export async function freshDomain(apiUrl: string, owner: Principal): Promise<{ id: string }> {
  const domain = await post<{ id: string }>(
    apiUrl,
    owner,
    "/domains",
    { domain: freshDomainName() },
    "create domain",
  );
  return { id: domain.id };
}

export async function freshBioPage(
  apiUrl: string,
  owner: Principal,
  status: "draft" | "live" = "draft",
): Promise<{ id: string; slug: string }> {
  const slug = `am-bio-${randomUUID().slice(0, 10)}`;
  const page = await put<{ id: string }>(
    apiUrl,
    owner,
    "/bio-pages",
    { domain: DEFAULT_DOMAIN, slug, status, profile: { name: "Access Matrix", bio: "" }, blocks: [] },
    "create bio page",
  );
  return { id: page.id, slug };
}

export async function freshWebhook(apiUrl: string, owner: Principal): Promise<{ id: string }> {
  const hook = await post<{ id: string }>(
    apiUrl,
    owner,
    "/webhooks",
    { endpoint: "https://example.com/hook", events: ["link.created"] },
    "create webhook",
  );
  return { id: hook.id };
}

export async function freshApiKey(apiUrl: string, owner: Principal): Promise<{ id: string }> {
  const key = await post<{ id: string }>(
    apiUrl,
    owner,
    "/api-keys",
    { name: `am-key-${randomUUID().slice(0, 8)}`, scopes: ["links:read"] },
    "create api key",
  );
  return { id: key.id };
}

export async function freshMember(apiUrl: string, owner: Principal): Promise<{ id: string }> {
  const member = await post<{ id: string }>(
    apiUrl,
    owner,
    "/members",
    { email: `am-invite-${randomUUID().slice(0, 8)}@example.com`, role: "editor" },
    "invite member",
  );
  return { id: member.id };
}

/**
 * Create one of each resource kind in `owner`'s workspace. Called once for A and
 * once for B so every `{id}` route has a real own-workspace target in each.
 */
export async function seedResources(apiUrl: string, owner: Principal): Promise<SeededResources> {
  const link = await freshLink(apiUrl, owner);
  const form = await freshForm(apiUrl, owner);
  const domain = await freshDomain(apiUrl, owner);
  // Live, so `/public/bio-pages/{slug}` resolves (a draft 404s publicly).
  const bioPage = await freshBioPage(apiUrl, owner, "live");
  const webhook = await freshWebhook(apiUrl, owner);
  const apiKey = await freshApiKey(apiUrl, owner);
  const member = await freshMember(apiUrl, owner);
  // An abuse report leaves no addressable {id} route, but exercising the public
  // intake once proves the owner's seeded link is reportable; the response is a
  // deliberately opaque { ok: true }.
  await post(apiUrl, owner, `/public/links/${link.slug}/report`, { reason: "access-matrix seed report" }, "submit report");

  return {
    linkId: link.id,
    formId: form.id,
    domainId: domain.id,
    bioPageId: bioPage.id,
    webhookId: webhook.id,
    apiKeyId: apiKey.id,
    memberId: member.id,
    linkSlug: link.slug,
    bioSlug: bioPage.slug,
  };
}
