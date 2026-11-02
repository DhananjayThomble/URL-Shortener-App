import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, eq, feedback, users, workspaces, type Database } from "@snapurl/database";
import { FeedbackService } from "./feedback.service.js";
import { MailService } from "../mail/mail.service.js";
import type { TokenService } from "../auth/token.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   FeedbackService.submit against a real Postgres + the real outbox mail
   transport — #997.

   Oracles are the issue's acceptance lines, not the implementation:
     - "Submitting creates a row AND an email (integration test with the outbox
       transport)" — one feedback row lands with the submitted message/context,
       and exactly one message file appears in the outbox dir addressed to the
       operator;
     - "it works for signed-out visitors on public pages" — a submit with NO
       Authorization header stores a row with null user/workspace and still
       emails the operator;
     - a signed-in submit (a verifiable session bearer) attaches the account's
       user id, workspace id and email SERVER-SIDE, never from the body;
     - #997 point 1/4: the captured context (page, app version, user-agent) and
       the optional errorEventId are stored; a bounded screenshot is stored.

   Red-on-broken: drop the insert and the row assertion fails; drop the
   notifyOperator call and the outbox is empty; read the submitter from the body
   instead of the session and the "body cannot forge identity" case fails.

   DB-gated: skips with no DATABASE_URL. The DB pool and nothing else is opened,
   and both the pool and the temp outbox dir are torn down in afterAll.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const PNG_PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/* A TokenService stub whose verifyAccessToken resolves ONLY for a known token,
   mirroring the real contract (sub/wid/role/email) — the service only reads
   sub, wid and email. Any other token rejects, so the anonymous path is taken. */
function tokenStub(known: { token: string; sub: string; wid: string; email: string }): TokenService {
  return {
    verifyAccessToken: async (t: string) => {
      if (t === known.token) return { sub: known.sub, wid: known.wid, role: "owner", email: known.email };
      throw new Error("invalid");
    },
  } as unknown as TokenService;
}

describeDb("FeedbackService.submit", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let outboxDir: string;
  let service: FeedbackService;
  let workspaceId: string;
  let userId: string;
  const stamp = Date.now();
  const userEmail = `fb-user-${stamp}@example.com`;
  const sessionToken = `session-${stamp}`;
  const createdIds: string[] = [];

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    outboxDir = await mkdtemp(join(tmpdir(), `fb-outbox-${stamp}-`));

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "feedback test", slug: `fb-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
    const [u] = await db
      .insert(users)
      .values({ email: userEmail, name: "FB User", passwordHash: "x" })
      .returning({ id: users.id });
    userId = u!.id;

    const env = {
      MAIL_TRANSPORT: "outbox",
      MAIL_OUTBOX_DIR: outboxDir,
      MAIL_FROM: "SnapURL <no-reply@snapurl.local>",
      FEEDBACK_NOTIFY_EMAIL: "ops@snapurl.local",
      PLATFORM_ADMIN_EMAILS: undefined,
    } as unknown as Env;
    const mail = new MailService(env);
    const tokens = tokenStub({ token: sessionToken, sub: userId, wid: workspaceId, email: userEmail });
    service = new FeedbackService(db, env, mail, tokens);
  });

  afterAll(async () => {
    for (const id of createdIds) await db.delete(feedback).where(eq(feedback.id, id));
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await rm(outboxDir, { recursive: true, force: true });
    await handle?.close();
  });

  it("creates a row AND emails the operator for a signed-out submit", async () => {
    const result = await service.submit(
      { message: "The share dialog never opens.", page: "/l/abc", appVersion: "2.1.7" },
      undefined, // no Authorization header — a signed-out visitor
      "Mozilla/5.0 (TestAgent)",
    );
    expect(result.ok).toBe(true);
    expect(result.id).toBeTruthy();
    createdIds.push(result.id);

    const [row] = await db.select().from(feedback).where(eq(feedback.id, result.id)).limit(1);
    expect(row).toBeDefined();
    expect(row!.message).toBe("The share dialog never opens.");
    expect(row!.page).toBe("/l/abc");
    expect(row!.appVersion).toBe("2.1.7");
    expect(row!.userAgent).toBe("Mozilla/5.0 (TestAgent)");
    expect(row!.status).toBe("new");
    // Signed-out: no account context attached.
    expect(row!.userId).toBeNull();
    expect(row!.workspaceId).toBeNull();
    expect(row!.reporterEmail).toBeNull();

    // The email landed in the outbox, addressed to the operator and naming the
    // report id. This is the acceptance's "an email (integration test with the
    // outbox transport)".
    const files = await readdir(outboxDir);
    expect(files.length).toBe(1);
    const body = await readFile(join(outboxDir, files[0]!), "utf8");
    expect(body).toContain("To: ops@snapurl.local");
    expect(body).toContain("New SnapURL problem report");
    expect(body).toContain(result.id);
    expect(body).toContain("The share dialog never opens.");
  });

  it("attaches the signed-in submitter's context from the session, never the body", async () => {
    const result = await service.submit(
      {
        message: "Analytics chart is blank.",
        // A forged identity in the body MUST be ignored — identity comes from
        // the verified session alone.
        reporterEmail: "attacker@evil.example",
        errorEventId: "evt_9f3a",
      },
      `Bearer ${sessionToken}`,
      "Mozilla/5.0",
    );
    createdIds.push(result.id);

    const [row] = await db.select().from(feedback).where(eq(feedback.id, result.id)).limit(1);
    expect(row!.userId).toBe(userId);
    expect(row!.workspaceId).toBe(workspaceId);
    // The session email wins; the body-supplied address is discarded.
    expect(row!.reporterEmail).toBe(userEmail);
    expect(row!.reporterEmail).not.toBe("attacker@evil.example");
    expect(row!.errorEventId).toBe("evt_9f3a");
  });

  it("degrades to anonymous for an invalid or API-key bearer (route stays public)", async () => {
    const bad = await service.submit({ message: "bad token path" }, "Bearer not-a-real-token", "UA");
    createdIds.push(bad.id);
    const [badRow] = await db.select().from(feedback).where(eq(feedback.id, bad.id)).limit(1);
    expect(badRow!.userId).toBeNull();
    expect(badRow!.workspaceId).toBeNull();

    const key = await service.submit({ message: "api key path" }, "Bearer snap_live_whatever", "UA");
    createdIds.push(key.id);
    const [keyRow] = await db.select().from(feedback).where(eq(feedback.id, key.id)).limit(1);
    expect(keyRow!.userId).toBeNull();
  });

  it("stores a bounded screenshot and a signed-out reporter's typed contact", async () => {
    const result = await service.submit(
      { message: "with screenshot", screenshot: PNG_PX, reporterEmail: "visitor@example.com" },
      undefined,
      "UA",
    );
    createdIds.push(result.id);
    const [row] = await db.select().from(feedback).where(eq(feedback.id, result.id)).limit(1);
    expect(row!.screenshot).toBe(PNG_PX);
    // Signed-out, so the body-supplied contact is kept (there is no session to override it).
    expect(row!.reporterEmail).toBe("visitor@example.com");
  });
});

/* ============================================================
   The operator recipient fallback: FEEDBACK_NOTIFY_EMAIL, else the first
   PLATFORM_ADMIN_EMAILS entry, else nobody (row stored, no email).
   ============================================================ */
describeDb("FeedbackService operator-notification recipient", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  const stamp = Date.now();
  const dirs: string[] = [];
  const createdIds: string[] = [];

  beforeAll(() => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
  });

  afterAll(async () => {
    for (const id of createdIds) await db.delete(feedback).where(eq(feedback.id, id));
    for (const d of dirs) await rm(d, { recursive: true, force: true });
    await handle?.close();
  });

  async function serviceWith(envOverrides: Partial<Env>): Promise<{ svc: FeedbackService; dir: string }> {
    const dir = await mkdtemp(join(tmpdir(), `fb-recip-${stamp}-`));
    dirs.push(dir);
    const env = {
      MAIL_TRANSPORT: "outbox",
      MAIL_OUTBOX_DIR: dir,
      MAIL_FROM: "SnapURL <no-reply@snapurl.local>",
      ...envOverrides,
    } as unknown as Env;
    const tokens = { verifyAccessToken: async () => { throw new Error("n/a"); } } as unknown as TokenService;
    return { svc: new FeedbackService(db, env, new MailService(env), tokens), dir };
  }

  it("falls back to the first platform-admin email when FEEDBACK_NOTIFY_EMAIL is unset", async () => {
    const { svc, dir } = await serviceWith({
      FEEDBACK_NOTIFY_EMAIL: undefined,
      PLATFORM_ADMIN_EMAILS: "boss@snapurl.local, second@snapurl.local",
    });
    const r = await svc.submit({ message: "fallback recipient" }, undefined, "UA");
    createdIds.push(r.id);
    const files = await readdir(dir);
    expect(files.length).toBe(1);
    const body = await readFile(join(dir, files[0]!), "utf8");
    expect(body).toContain("To: boss@snapurl.local");
  });

  it("stores the row but sends no email when no recipient is configured", async () => {
    const { svc, dir } = await serviceWith({ FEEDBACK_NOTIFY_EMAIL: undefined, PLATFORM_ADMIN_EMAILS: undefined });
    const r = await svc.submit({ message: "no recipient" }, undefined, "UA");
    createdIds.push(r.id);
    const [row] = await db.select().from(feedback).where(eq(feedback.id, r.id)).limit(1);
    expect(row).toBeDefined(); // row still stored
    const files = await readdir(dir);
    expect(files.length).toBe(0); // no email
  });
});
