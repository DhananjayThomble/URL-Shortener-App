/* Seeded principals for the HTTP stack suites (spec: api-stack-tests, H4,
 * design §4).
 *
 * Nine principals that between them exercise every authorization dimension the
 * API has — anonymous, the four session roles in workspace A, an owner of a
 * second workspace B (the cross-tenant probe), and three API keys with
 * different scopes — plus one resource of each kind in A and B so every `{id}`
 * route has a real target. Seeding talks to the real API over HTTP wherever it
 * can (so creation goes through the real code paths), and drops to direct SQL
 * over STACK_DATABASE_URL only for the two things HTTP cannot express: a
 * membership row with a chosen role, and an apiKeys row with chosen scopes —
 * the exact shapes of `session-hardening.integration.test.ts` and
 * `api-key-scope.integration.test.ts:61-75`.
 *
 * This module is test support, not application code: it is excluded from the
 * production build (apps/api/tsconfig.json) and only ever imported by the stack
 * suites.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  apiKeys,
  createDatabase,
  eq,
  inArray,
  memberships,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";

export type PrincipalName =
  | "anon"
  | "ownerA"
  | "adminA"
  | "editorA"
  | "viewerA"
  | "ownerB"
  | "keyA-all"
  | "keyA-links-read"
  | "keyB-all";

export interface Principal {
  name: PrincipalName;
  /** The `Authorization` header value, or null for the anonymous principal. */
  authorization: string | null;
  /** The role this principal acts as (API keys always act as `editor`). */
  role: "owner" | "admin" | "editor" | "viewer" | "anon";
  /** The workspace this principal belongs to, "A" or "B" (null for anon). */
  workspace: "A" | "B" | null;
  userId?: string;
  workspaceId?: string;
}

export interface SeededStack {
  principals: Record<PrincipalName, Principal>;
  /** Workspace ids, so a suite can target A's resources as B and vice versa. */
  workspaceA: string;
  workspaceB: string;
  /** Tear everything down by id. Safe to call more than once. */
  cleanup: () => Promise<void>;
}

const ALL_SCOPES = ["links:read", "links:write", "analytics:read", "domains:read", "domains:write", "conversions:write"];

interface SeedConfig {
  apiUrl: string;
  databaseUrl: string;
  /** Register throttle is 5/min/IP; cap the back-off so a wrong env fails fast. */
  maxRegisterWaitMs?: number;
}

/** A strong password that always clears RegisterInput's 12-char minimum. */
function password(): string {
  return `Pw-${randomBytes(12).toString("base64url")}`;
}

function initialsOf(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`;
}

/**
 * Register a brand-new account over HTTP, backing off on the 5/min/IP register
 * throttle (429) rather than failing the first time the bucket is empty. The
 * total wait is bounded so a genuinely broken stack fails fast instead of
 * hanging for a minute per call.
 */
async function register(
  cfg: SeedConfig,
  name: string,
): Promise<{ accessToken: string; refreshToken: string; userId: string; email: string }> {
  const email = `stack-${name}-${randomUUID()}@example.com`;
  const body = JSON.stringify({ name, email, password: password() });
  const deadline = Date.now() + (cfg.maxRegisterWaitMs ?? 90_000);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${cfg.apiUrl}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    if (res.status === 201) {
      const session = (await res.json()) as { accessToken: string; refreshToken: string; user: { id: string } };
      return { accessToken: session.accessToken, refreshToken: session.refreshToken, userId: session.user.id, email };
    }

    if (res.status === 429 && Date.now() < deadline) {
      // Exponential-ish back-off, capped — the window is 60s, so never wait
      // longer than that in one sleep.
      const wait = Math.min(2_000 * 2 ** attempt, 15_000);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    throw new Error(`register(${name}) failed: ${await readError(res)}`);
  }
}

/** Exchange a refresh token for an access token scoped to a given workspace,
 *  so the returned JWT carries that workspace's membership role (#699). */
async function refreshInto(cfg: SeedConfig, refreshToken: string, workspaceId: string): Promise<string> {
  const res = await fetch(`${cfg.apiUrl}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken, workspaceId }),
  });
  if (res.status !== 200) throw new Error(`refresh into ${workspaceId} failed: ${await readError(res)}`);
  const pair = (await res.json()) as { accessToken: string };
  return pair.accessToken;
}

/** The workspace id register() created for a freshly-registered owner — their
 *  only active membership at that point. */
async function ownerWorkspaceId(db: Database, userId: string): Promise<string> {
  const [row] = await db
    .select({ workspaceId: memberships.workspaceId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  if (!row) throw new Error(`no membership for freshly-registered user ${userId}`);
  return row.workspaceId;
}

/** Insert an API key row with chosen scopes, returning the raw key (the only
 *  time it exists in the clear) and its id for cleanup. Mirrors
 *  api-key-scope.integration.test.ts:61-75. */
async function insertApiKey(
  db: Database,
  workspaceId: string,
  name: string,
  scopes: string[],
): Promise<{ raw: string; id: string }> {
  const raw = `snap_live_${randomBytes(24).toString("hex")}`;
  const id = randomUUID();
  await db.insert(apiKeys).values({
    id,
    workspaceId,
    name,
    keyPrefix: raw.slice(0, 12),
    keyLast4: raw.slice(-4),
    keyHash: createHash("sha256").update(raw).digest("hex"),
    scopes,
  });
  return { raw, id };
}

/**
 * Seed the nine principals (design §4) against the running stack. The caller
 * owns `cleanup()` in `afterAll`.
 */
export async function seedPrincipals(cfg: SeedConfig): Promise<SeededStack> {
  const handle = createDatabase({ url: cfg.databaseUrl, max: 2 });
  const db = handle.db;

  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const apiKeyIds: string[] = [];

  const cleanup = async () => {
    try {
      if (apiKeyIds.length) await db.delete(apiKeys).where(inArray(apiKeys.id, apiKeyIds));
      // memberships and api keys cascade on workspace delete, but delete rows
      // explicitly too so a partial seed still tidies up.
      if (workspaceIds.length) await db.delete(memberships).where(inArray(memberships.workspaceId, workspaceIds));
      if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
      if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    } finally {
      await handle.close();
    }
  };

  try {
    // Owners of A and B, each created through register() (which also creates
    // their workspace + owner membership).
    const ownerAReg = await register(cfg, "ownerA");
    userIds.push(ownerAReg.userId);
    const workspaceA = await ownerWorkspaceId(db, ownerAReg.userId);
    workspaceIds.push(workspaceA);

    const ownerBReg = await register(cfg, "ownerB");
    userIds.push(ownerBReg.userId);
    const workspaceB = await ownerWorkspaceId(db, ownerBReg.userId);
    workspaceIds.push(workspaceB);

    // admin / editor / viewer of A: register a fresh account, add an active
    // membership of A with the target role, then refresh into A so the token
    // carries that role.
    const seedRole = async (
      pName: PrincipalName,
      role: "admin" | "editor" | "viewer",
    ): Promise<Principal> => {
      const reg = await register(cfg, pName);
      userIds.push(reg.userId);
      await db.insert(memberships).values({
        id: randomUUID(),
        workspaceId: workspaceA,
        userId: reg.userId,
        email: reg.email,
        role,
        status: "active",
        acceptedAt: new Date(),
      });
      const accessToken = await refreshInto(cfg, reg.refreshToken, workspaceA);
      return {
        name: pName,
        authorization: `Bearer ${accessToken}`,
        role,
        workspace: "A",
        userId: reg.userId,
        workspaceId: workspaceA,
      };
    };

    const adminA = await seedRole("adminA", "admin");
    const editorA = await seedRole("editorA", "editor");
    const viewerA = await seedRole("viewerA", "viewer");

    // API keys: all-scopes and links-read-only in A, all-scopes in B.
    const keyAll = await insertApiKey(db, workspaceA, "stack keyA-all", ALL_SCOPES);
    apiKeyIds.push(keyAll.id);
    const keyLinksRead = await insertApiKey(db, workspaceA, "stack keyA-links-read", ["links:read"]);
    apiKeyIds.push(keyLinksRead.id);
    const keyB = await insertApiKey(db, workspaceB, "stack keyB-all", ALL_SCOPES);
    apiKeyIds.push(keyB.id);

    const principals: Record<PrincipalName, Principal> = {
      anon: { name: "anon", authorization: null, role: "anon", workspace: null },
      ownerA: {
        name: "ownerA",
        authorization: `Bearer ${ownerAReg.accessToken}`,
        role: "owner",
        workspace: "A",
        userId: ownerAReg.userId,
        workspaceId: workspaceA,
      },
      adminA,
      editorA,
      viewerA,
      ownerB: {
        name: "ownerB",
        authorization: `Bearer ${ownerBReg.accessToken}`,
        role: "owner",
        workspace: "B",
        userId: ownerBReg.userId,
        workspaceId: workspaceB,
      },
      "keyA-all": { name: "keyA-all", authorization: `Bearer ${keyAll.raw}`, role: "editor", workspace: "A" },
      "keyA-links-read": {
        name: "keyA-links-read",
        authorization: `Bearer ${keyLinksRead.raw}`,
        role: "editor",
        workspace: "A",
      },
      "keyB-all": { name: "keyB-all", authorization: `Bearer ${keyB.raw}`, role: "editor", workspace: "B" },
    };

    return { principals, workspaceA, workspaceB, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
