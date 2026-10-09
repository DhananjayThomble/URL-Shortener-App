/**
 * Journey 17 — Workspace state stays coherent across tabs and session changes (#699)
 *
 * Follow-ups to #668 found by the post-merge review:
 *   (a) switching workspace in one tab must not leave another tab showing the
 *       old workspace while its requests already go to the new one;
 *   (b) when the membership a tab is in disappears, the tab must move to the
 *       workspace its session is really in, not keep the old one on screen;
 *   (c) the post-sign-in `?next=` must never leave the site, including through
 *       dot-segment tricks that normalise into "//host".
 *
 * Oracles: the sidebar's workspace button (what the person sees), the URL,
 * and GET /workspaces/current with the token the tab actually holds.
 * One password sign-in for the whole spec (login throttle is 5/min per IP).
 * Requires the local staging stack + web on :3000.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { API_URL, RUN_ID, RUN_PASSWORD, TOKEN_KEY, REFRESH_KEY, makeEmail, type Session } from "./helpers";

const run = promisify(execFile);
const API_CONTAINER = process.env.QA_API_CONTAINER ?? "snapurl-staging-api-1";

async function register(name: string, email: string): Promise<Session> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email, password: RUN_PASSWORD }),
  });
  expect(res.status, "register").toBe(201);
  const b = (await res.json()) as { accessToken: string; refreshToken: string; user: { id: string } };
  const wid = JSON.parse(Buffer.from(b.accessToken.split(".")[1]!, "base64url").toString()).wid as string;
  return { accessToken: b.accessToken, refreshToken: b.refreshToken, email, userId: b.user.id, workspaceId: wid };
}

async function api(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/** Newest link of `path` in the newest matching mail to `email` (outbox in the api container). */
async function mailToken(email: string, path: "/invite" | "/verify-email"): Promise<string> {
  const sanitized = email.replace(/[^a-z0-9]/gi, "_");
  for (let i = 0; i < 40; i++) {
    try {
      const { stdout } = await run("docker", [
        "exec", API_CONTAINER, "sh", "-c",
        `ls /tmp/snapurl-outbox/ 2>/dev/null | grep -F -- '-${sanitized}.txt' | sort -t- -k1,1 -n -r`,
      ]);
      for (const name of stdout.split("\n").filter(Boolean)) {
        const { stdout: body } = await run("docker", ["exec", API_CONTAINER, "cat", `/tmp/snapurl-outbox/${name}`]);
        const m = body.match(new RegExp(`${path}\\?token=([^\\s&]+)`));
        if (m) return m[1]!;
      }
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${path} mail for ${email}`);
}

/** Put a session into the context's localStorage once (unlike addInitScript,
 *  this does not re-seed on every reload, which would mask token changes). */
async function signInBySeed(page: Page, s: Session) {
  await page.goto("/login");
  await page.evaluate(
    ([k1, k2, a, r]) => {
      window.localStorage.setItem(k1!, a!);
      window.localStorage.setItem(k2!, r!);
    },
    [TOKEN_KEY, REFRESH_KEY, s.accessToken, s.refreshToken],
  );
}

const workspaceButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Workspace: ${name}. Switch workspace` });
const heldToken = (page: Page) => page.evaluate((k) => window.localStorage.getItem(k) ?? "", TOKEN_KEY);
async function currentWorkspaceOf(page: Page) {
  return ((await (await api(await heldToken(page), "/workspaces/current")).json()) as { id: string; name: string });
}

test.describe("Journey 17 — cross-tab workspace coherence + safe post-login redirect (#699)", () => {
  test.describe.configure({ mode: "serial" });

  const tag = RUN_ID.slice(-4);
  const ownerName = `J17 Owner ${tag}`;
  const memberName = `J17 Member ${tag}`;
  const ownerWs = `${ownerName}'s workspace`;
  const memberWs = `${memberName}'s workspace`;
  let owner: Session;
  let member: Session;
  let memberMembershipId: string;
  let ctx: BrowserContext;
  let tab1: Page;
  let tab2: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    owner = await register(ownerName, makeEmail("j17-owner"));
    member = await register(memberName, makeEmail("j17-member"));
    // Verify the member through the link the API mailed, invite, accept.
    const verify = await mailToken(member.email, "/verify-email");
    expect((await fetch(`${API_URL}/auth/email/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: verify }) })).status).toBe(200);
    expect((await api(owner.accessToken, "/members", { method: "POST", body: JSON.stringify({ email: member.email, role: "editor" }) })).status).toBe(201);
    const invite = await mailToken(member.email, "/invite");
    expect((await api(member.accessToken, "/auth/invite/accept", { method: "POST", body: JSON.stringify({ token: invite }) })).status).toBe(200);
    const rows = (await (await api(owner.accessToken, "/members")).json()) as Array<{ id: string; email: string }>;
    memberMembershipId = rows.find((r) => r.email.toLowerCase() === member.email.toLowerCase())!.id;

    ctx = await browser.newContext(); // one context = shared localStorage, like two tabs
    tab1 = await ctx.newPage();
    tab2 = await ctx.newPage();
    await signInBySeed(tab1, member);
  });

  test.afterAll(async () => {
    await ctx?.close();
  });

  test("(a) switching in tab 1 moves tab 2 too: cache dropped, routed to /links, sidebar names the new workspace", async () => {
    await tab1.goto("/links");
    await tab2.goto("/settings");
    await expect(workspaceButton(tab1, memberWs)).toBeVisible({ timeout: 20_000 });
    await expect(workspaceButton(tab2, memberWs)).toBeVisible({ timeout: 20_000 });

    // Real switch in tab 1.
    await workspaceButton(tab1, memberWs).click();
    await tab1.getByRole("menu", { name: "Workspaces" }).getByRole("menuitemradio", { name: new RegExp(ownerWs) }).click();
    await expect(workspaceButton(tab1, ownerWs)).toBeVisible();

    // Tab 2 was not touched by the user. Its token is now the owner-workspace
    // one (shared storage) — and its screen must follow, not keep "member".
    expect((await currentWorkspaceOf(tab2)).id).toBe(owner.workspaceId);
    await expect(tab2).toHaveURL(/\/links$/, { timeout: 10_000 });
    await expect(workspaceButton(tab2, ownerWs)).toBeVisible({ timeout: 10_000 });
    await expect(workspaceButton(tab2, memberWs)).toHaveCount(0);
  });

  test("(b) removed from the workspace a tab is in: the tab moves to the workspace its session is really in", async () => {
    await tab2.close();
    await tab1.goto("/team");
    await expect(workspaceButton(tab1, ownerWs)).toBeVisible({ timeout: 20_000 });

    // Owner removes the member. Their access token still claims the owner's
    // workspace until it expires.
    expect((await api(owner.accessToken, `/members/${memberMembershipId}`, { method: "DELETE" })).status).toBe(204);

    const me = tab1.waitForResponse((r) => /\/auth\/me$/.test(r.url()));
    await tab1.reload();
    expect((await me).status(), "GET /auth/me refuses the stale workspace claim").toBe(401);
    await expect(tab1).toHaveURL(/\/links$/, { timeout: 15_000 });
    await expect(workspaceButton(tab1, memberWs)).toBeVisible({ timeout: 15_000 });
    expect((await currentWorkspaceOf(tab1)).id).toBe(member.workspaceId);
  });

  test("(c) ?next= dot-segment bypass cannot send a signed-in user off-site", async ({ browser }) => {
    const c = await browser.newContext();
    const page = await c.newPage();
    // Never actually reach the outside world. Match the HOST: the /login URL
    // itself carries "evil.example" in its query string.
    const offHost = (u: string | URL) => new URL(String(u)).hostname.endsWith("evil.example");
    await page.route((u) => offHost(u), (route) => route.abort());
    const offsite: string[] = [];
    page.on("request", (r) => {
      if (offHost(r.url())) offsite.push(r.url());
    });
    try {
      await page.goto("/login?next=" + encodeURIComponent("/..//evil.example/login"));
      await page.getByPlaceholder("you@company.com").fill(owner.email);
      await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/links$/, { timeout: 20_000 });
      expect(offsite).toEqual([]);
    } finally {
      await c.close();
    }
  });
});

/* ── (x) and (z): token changes the earlier guard did not see ──────────────
   Independent tests (own users, not serial with the block above) so a failure
   here never skips (a)–(c). Oracle for both: what the tab SHOWS (sidebar
   workspace button) must be the workspace its writes land in — read back
   through GET /links with the token the tab really holds. */

const widOf = (t: string) => JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString()).wid as string;

/** Make `member` a verified, accepted `role` member of each owner's workspace. */
async function joinAll(member: Session, owners: Session[], role: "editor" | "admin") {
  const verify = await mailToken(member.email, "/verify-email");
  expect((await fetch(`${API_URL}/auth/email/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: verify }) })).status).toBe(200);
  for (const o of owners) {
    expect((await api(o.accessToken, "/members", { method: "POST", body: JSON.stringify({ email: member.email, role }) })).status).toBe(201);
    const invite = await mailToken(member.email, "/invite");
    expect((await api(member.accessToken, "/auth/invite/accept", { method: "POST", body: JSON.stringify({ token: invite }) })).status).toBe(200);
  }
}

/** A session for `s` entered into `workspaceId` (through refresh, like the switcher). */
async function sessionIn(s: Session, workspaceId: string) {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: s.refreshToken, workspaceId }),
  });
  expect(res.status).toBe(200);
  const b = (await res.json()) as { accessToken: string; refreshToken: string };
  expect(widOf(b.accessToken)).toBe(workspaceId);
  return { ...s, accessToken: b.accessToken, refreshToken: b.refreshToken, workspaceId };
}

/** Create a link through the real drawer; returns the POST status. */
async function createLinkInUi(page: Page, dest: string) {
  await page.getByRole("button", { name: /New link/ }).first().click();
  await page.getByLabel("Destination URL").fill(dest);
  const created = page.waitForResponse((r) => /\/links$/.test(r.url()) && r.request().method() === "POST", { timeout: 10_000 });
  await page.getByRole("button", { name: "Create link" }).click();
  return (await created).status();
}

async function linkLandedIn(token: string, dest: string) {
  return JSON.stringify(await (await api(token, "/links")).json()).includes(dest);
}

test("(x) sign-out + sign-in in tab 1 moves tab 2 off the old workspace; its writes land where it shows", async ({ browser }) => {
  const tag = RUN_ID.slice(-4) + "x";
  const ownerName = `J17x Owner ${tag}`;
  const memberName = `J17x Member ${tag}`;
  const ownerWs = `${ownerName}'s workspace`;
  const memberWs = `${memberName}'s workspace`;
  const owner = await register(ownerName, makeEmail("j17x-owner"));
  const member = await register(memberName, makeEmail("j17x-member"));
  await joinAll(member, [owner], "admin");
  const inOwner = await sessionIn(member, owner.workspaceId);

  const c = await browser.newContext();
  try {
    const tab1 = await c.newPage();
    const tab2 = await c.newPage();
    await signInBySeed(tab1, inOwner);
    await tab1.goto("/links");
    await tab2.goto("/settings");
    await expect(workspaceButton(tab1, ownerWs)).toBeVisible({ timeout: 20_000 });
    await expect(workspaceButton(tab2, ownerWs)).toBeVisible({ timeout: 20_000 });
    await expect(tab2.getByRole("heading", { name: "Settings" })).toBeVisible();
    // A pending edit on tab 2's owner-workspace form.
    await tab2.getByRole("group", { name: "Default redirect type" }).locator('button:not([aria-pressed="true"])').first().click();
    const tab2Writes: string[] = [];
    tab2.on("request", (r) => {
      if (r.method() !== "GET" && /\/workspaces\/current$/.test(r.url())) tab2Writes.push(`${r.method()} ${r.url()}`);
    });

    // Tab 1: real sign-out, real sign-in -> lands in the member's own workspace.
    await tab1.getByRole("button", { name: `Account menu for ${memberName}` }).click();
    await tab1.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(tab1).toHaveURL(/\/login/, { timeout: 15_000 });
    await tab1.getByPlaceholder("you@company.com").fill(member.email);
    await tab1.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
    await tab1.getByRole("button", { name: "Sign in" }).click();
    await expect(tab1).toHaveURL(/\/links$/, { timeout: 20_000 });
    await expect(workspaceButton(tab1, memberWs)).toBeVisible({ timeout: 20_000 });

    // Tab 2 now holds a token for the member's workspace. Its screen must follow.
    const held = await heldToken(tab2);
    expect(widOf(held), "tab 2 shares the new session").toBe(member.workspaceId);
    await expect(tab2, "tab 2 left the stale settings form").toHaveURL(/\/links$/, { timeout: 10_000 });
    await expect(workspaceButton(tab2, memberWs)).toBeVisible({ timeout: 10_000 });
    await expect(workspaceButton(tab2, ownerWs)).toHaveCount(0);
    expect(tab2Writes, "the stale owner-workspace form never reached the API").toEqual([]);

    // A link created in tab 2 lands in the workspace tab 2 shows.
    const dest = `https://example.com/j17x-${tag}`;
    expect(await createLinkInUi(tab2, dest)).toBe(201);
    expect(await linkLandedIn(held, dest), "link is in the workspace on screen (member's own)").toBe(true);
    expect(await linkLandedIn(owner.accessToken, dest), "link is not in the owner's workspace").toBe(false);
  } finally {
    await c.close();
  }
});

test("(z) switching into a workspace you were just removed from moves the tab to where its session really is", async ({ browser }) => {
  const tag = RUN_ID.slice(-4) + "z";
  const o1Name = `J17z O1 ${tag}`;
  const o2Name = `J17z O2 ${tag}`;
  const mName = `J17z Member ${tag}`;
  const o1Ws = `${o1Name}'s workspace`;
  const o2Ws = `${o2Name}'s workspace`;
  const mWs = `${mName}'s workspace`;
  const o1 = await register(o1Name, makeEmail("j17z-o1"));
  const o2 = await register(o2Name, makeEmail("j17z-o2"));
  const m = await register(mName, makeEmail("j17z-member"));
  await joinAll(m, [o1, o2], "editor");
  const inO1 = await sessionIn(m, o1.workspaceId);

  const c = await browser.newContext();
  try {
    const tab = await c.newPage();
    await signInBySeed(tab, inO1);
    await tab.goto("/links");
    await expect(workspaceButton(tab, o1Ws)).toBeVisible({ timeout: 20_000 });
    await workspaceButton(tab, o1Ws).click();
    const item = tab.getByRole("menu", { name: "Workspaces" }).getByRole("menuitemradio", { name: new RegExp(o2Ws) });
    await expect(item).toBeVisible();

    // Owner 2 removes the member while the switcher menu is open; then they pick O2.
    const rows = (await (await api(o2.accessToken, "/members")).json()) as Array<{ id: string; email: string }>;
    const mid = rows.find((r) => r.email.toLowerCase() === m.email.toLowerCase())!.id;
    expect((await api(o2.accessToken, `/members/${mid}`, { method: "DELETE" })).status).toBe(204);
    await item.click();

    // The refresh fell back to the member's own workspace; the screen must say so.
    await expect.poll(async () => widOf(await heldToken(tab)), { timeout: 10_000 }).toBe(m.workspaceId);
    await expect(tab).toHaveURL(/\/links$/, { timeout: 10_000 });
    await expect(workspaceButton(tab, mWs), "sidebar names the workspace the token is in").toBeVisible({ timeout: 10_000 });
    await expect(workspaceButton(tab, o1Ws), "sidebar no longer shows O1").toHaveCount(0);

    await tab.keyboard.press("Escape");
    const dest = `https://example.com/j17z-${tag}`;
    expect(await createLinkInUi(tab, dest)).toBe(201);
    const held = await heldToken(tab);
    expect(await linkLandedIn(held, dest), "link is in the workspace on screen (member's own)").toBe(true);
    expect(await linkLandedIn(o1.accessToken, dest), "link is not in O1").toBe(false);
  } finally {
    await c.close();
  }
});
