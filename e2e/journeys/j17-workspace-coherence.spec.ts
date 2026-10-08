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
    // Never actually reach the outside world.
    await page.route(/evil\.example/, (route) => route.abort());
    const offsite: string[] = [];
    page.on("request", (r) => {
      if (/evil\.example/.test(r.url())) offsite.push(r.url());
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
