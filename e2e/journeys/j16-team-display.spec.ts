/**
 * Journey 16 — /team renders real times and only real permissions (#669)
 *
 * Before #669 the team page:
 *   - showed "Invited 2 days ago" for EVERY pending invite (a string literal),
 *     including one sent a second ago;
 *   - printed the raw ISO timestamp the API returns in "Last active" and in the
 *     Recent activity feed;
 *   - listed a "Billing & plan" permission in the role matrix although billing
 *     controls were removed (docs/DECISIONS.md, Billing section).
 *
 * A real owner does: register -> /team -> ＋ Invite -> Send invitation, then
 * reads the page. Oracles are the timestamps the API itself holds (invitedAt on
 * the member, lastActive, audit `at`) and the DOM text after the real click.
 *
 * Uses a seeded session (no login), so it does not consume the login throttle.
 * Requires the local staging stack + web on :3000.
 */

import { execFile } from "node:child_process";
import { expect, test } from "@playwright/test";
import { API_URL, TOKEN_KEY, makeEmail, registerUser, seedAccount, type Session } from "./helpers";

const DB_CONTAINER = process.env.DB_CONTAINER ?? "snapurl-staging-postgres";
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Test fixture: run one SQL statement in the staging database. */
async function sql(statement: string, vars: Record<string, string>) {
  const args = ["exec", "-i", DB_CONTAINER, "psql", "-U", "snapurl", "-d", "snapurl", "-v", "ON_ERROR_STOP=1"];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  const child = execFile("docker", args);
  let out = "";
  child.stdout?.on("data", (d) => (out += d));
  child.stdin?.end(statement);
  await new Promise((r) => child.on("close", r));
  return out;
}

const get = async (owner: Session, path: string) =>
  (await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${owner.accessToken}` } })).json();

test.describe("Journey 16 — /team times and permissions (#669)", () => {
  test.describe.configure({ mode: "serial" });

  let owner: Session;
  const inviteeEmail = makeEmail("j16-invitee");
  const olderEmail = makeEmail("j16-older");

  test("a just-sent invite reads 'just now'; the matrix has no Billing row; no raw ISO anywhere", async ({ page }) => {
    owner = await registerUser(makeEmail("j16-owner"));
    await seedAccount(page, owner);

    await page.goto("/team");
    await page.getByRole("button", { name: "＋ Invite" }).click();
    await page.getByPlaceholder("teammate@example.com").fill(inviteeEmail);
    const sent = page.waitForResponse((r) => r.request().method() === "POST" && /\/members$/.test(r.url()));
    await page.getByRole("button", { name: "Send invitation" }).click();
    expect((await sent).status()).toBe(201);

    // Oracle: the API recorded invitedAt ~ now (this is what the page must reflect).
    const members = (await get(owner, "/members")) as Array<{ email: string; status: string; invitedAt: string | null; lastActive: string | null }>;
    const invited = members.find((m) => m.email.toLowerCase() === inviteeEmail.toLowerCase());
    expect(invited?.status).toBe("invited");
    expect(invited?.invitedAt, "API exposes when the invite was sent").toBeTruthy();
    expect(Date.now() - new Date(invited!.invitedAt!).getTime()).toBeLessThan(60_000);

    // The pending row says "just now" — not the old hard-coded "2 days ago".
    const pending = page.getByRole("row").filter({ hasText: "pending" });
    await expect(pending.getByText("Invited just now")).toBeVisible();
    await expect(pending.getByText(/2 days ago/)).toHaveCount(0);

    // Role matrix: only permissions that exist.
    const matrix = page.getByRole("table", { name: "What each role can do" }).or(page.getByLabel("What each role can do"));
    await expect(matrix.getByText("Invite & remove members")).toBeVisible();
    await expect(page.getByText("Billing & plan")).toHaveCount(0);
    await expect(page.getByText(/billing/i)).toHaveCount(0);

    // Recent activity feed shows a human time for the invite we just sent.
    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
    await expect(page.getByText("just now", { exact: true }).first()).toBeVisible();

    // No raw ISO timestamp is rendered anywhere on the page.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(ISO);
  });

  test("older timestamps are relative to the stored value (invite 5 days ago; owner just active)", async ({ page }) => {
    // Re-inviting would 409; invite a second person via the API and age the rows in the DB.
    const res = await fetch(`${API_URL}/members`, {
      method: "POST",
      headers: { authorization: `Bearer ${owner.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ email: olderEmail, role: "viewer" }),
    });
    expect(res.status).toBe(201);
    expect(await sql(
      `update memberships set invited_at = now() - interval '5 days' where lower(email) = lower(:'email') and status = 'invited';`,
      { email: olderEmail },
    )).toContain("UPDATE 1");
    await seedAccount(page, owner);
    await page.goto("/team");

    // Oracle: raw values the API serves for these rows.
    const members = (await get(owner, "/members")) as Array<{ email: string; invitedAt: string | null; lastActive: string | null }>;
    expect(members.find((m) => m.email === olderEmail)?.invitedAt).toMatch(ISO);
    
    await expect(page.getByRole("row").filter({ hasText: olderEmail }).getByText("Invited 5 days ago")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: inviteeEmail }).getByText("Invited just now")).toBeVisible();
    // Owner row: Last active is human-formatted from users.last_active_at (the
    // app stamps it on the session refresh this very page load triggers), never the raw ISO.
    const refreshed = (await get(owner, "/members")) as Array<{ email: string; lastActive: string | null }>;
    const ownerActive = refreshed.find((m) => m.email === owner.email)?.lastActive;
    expect(ownerActive).toMatch(ISO);
    expect(Date.now() - new Date(ownerActive!).getTime()).toBeLessThan(120_000);
    await expect(page.getByRole("row").filter({ hasText: owner.email }).getByRole("cell", { name: /^(just now|\d+ min ago)$/ })).toBeVisible();

    expect(await page.locator("body").innerText()).not.toMatch(ISO);
    // The session is still the owner's (the page did not bounce us to /login).
    expect(await page.evaluate((k) => window.localStorage.getItem(k), TOKEN_KEY)).toBeTruthy();
  });
});
