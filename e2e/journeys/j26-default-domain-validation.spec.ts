/**
 * Journey 26 — Settings > Default domain is validated and chosen from a list (#779)
 *
 * Before #779, PATCH /workspaces/current {defaultDomain: "not-mine.example"}
 * answered 200, saved every OTHER field in the same request, kept the old
 * default, and the Settings screen showed no message and kept its Save /
 * Discard bar up as if the change were pending.
 *
 * A workspace owner now:
 *   - cannot save a domain that is unknown, another workspace's, or still
 *     verifying: 400 with a readable sentence, and NOTHING in the PATCH is saved;
 *   - opens Settings and gets a select of the workspace's live domains only;
 *     picks one, saves, the bar goes away, and a reload shows it stored;
 *   - an owner's typed variants (case, spaces, trailing dot) resolve to the
 *     stored domain rather than being silently dropped;
 *   - a viewer sees the control disabled with the reason, and the API says 403.
 *
 * Oracles (independent of the implementation): the issue's acceptance criteria;
 * the same rule POST /links applies ("isn't verified yet"); GET /workspaces/current
 * and GET /domains read back from the real API; PATCH /workspaces/current is
 * @Roles("admin"). The viewer is a real token minted at login after the
 * membership row is changed (roles ride the JWT).
 *
 * Requires the local staging stack (api :3001, redirect :3002, postgres :5435)
 * and the web app on :3000 — see playwright.journeys.config.ts.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { API_URL, RUN_ID, RUN_PASSWORD, makeEmail, registerUser, type Session } from "./helpers";

// Run SQL inside the staging Postgres container with `docker exec`, the pattern
// j15/j16/j23 already use (SQL on stdin). CI has no host `psql` binary; the
// docker CLI is always present on a GitHub runner. The container name comes
// from the compose project name `snapurl-staging`, overridable with
// DB_CONTAINER (docker-compose.staging.yml; spec design §1 "Facts").
const DB_CONTAINER = process.env.DB_CONTAINER ?? "snapurl-staging-postgres";
const SHOTS = process.env.QA_EVIDENCE_DIR ?? path.resolve(__dirname, "../../.qa-runs/779");

interface DomainRow {
  id: string;
  domain: string;
  status: string;
}
interface Workspace {
  defaultDomain: string;
  currency: string;
  name: string;
}

async function call(token: string, method: string, p: string, body?: unknown) {
  const res = await fetch(`${API_URL}${p}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const message = (json: unknown): string => {
  const m = (json as { message?: string | string[] }).message;
  return Array.isArray(m) ? m.join("; ") : (m ?? "");
};

function psql(sql: string) {
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "snapurl", "-d", "snapurl", "-v", "ON_ERROR_STOP=1"],
    { input: sql, stdio: ["pipe", "pipe", "pipe"] },
  );
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test.describe("Journey 26 — default domain validation (#779)", () => {
  test.describe.configure({ mode: "serial" });

  let owner: Session;
  let stranger: Session;
  let base: Workspace; // the owner's workspace before any change
  let pending: DomainRow;
  let verified: DomainRow;
  let foreign: DomainRow;
  let page: Page;
  const get = async () => (await call(owner.accessToken, "GET", "/workspaces/current")).json as Workspace;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    owner = await registerUser(makeEmail("j26-owner"));
    stranger = await registerUser(makeEmail("j26-other"));

    base = await get();

    pending = (await call(owner.accessToken, "POST", "/domains", { domain: `pending-${RUN_ID}.j26-example.test` })).json as DomainRow;
    verified = (await call(owner.accessToken, "POST", "/domains", { domain: `Verified-${RUN_ID}.j26-example.test` })).json as DomainRow;
    foreign = (await call(stranger.accessToken, "POST", "/domains", { domain: `foreign-${RUN_ID}.j26-example.test` })).json as DomainRow;
    // DNS verification cannot run locally; mark them verified as the verify endpoint would.
    psql(`update domains set status='live', ssl='active', verified_at=now() where id in ('${verified.id}','${foreign.id}')`);
    expect(pending.domain, "precondition: a pending own domain").toBeTruthy();

    page = await browser.newPage();
  });
  test.afterAll(async () => {
    await page.close();
  });

  test("(a) an unknown domain is a 400 in plain words and the whole PATCH is rejected", async () => {
    const r = await call(owner.accessToken, "PATCH", "/workspaces/current", {
      defaultDomain: "not-mine.example",
      currency: "USD",
    });
    expect(r.status).toBe(400);
    expect(message(r.json)).toBe("not-mine.example isn't a domain in this workspace.");
    const after = await get();
    expect(after.defaultDomain, "default unchanged").toBe(base.defaultDomain);
    expect(after.currency, "the other field in the same PATCH was not saved either").toBe(base.currency);
  });

  test("(b) another workspace's live domain is refused the same way (nothing leaks)", async () => {
    const r = await call(owner.accessToken, "PATCH", "/workspaces/current", { defaultDomain: foreign.domain });
    expect(r.status).toBe(400);
    expect(message(r.json)).toBe(`${foreign.domain} isn't a domain in this workspace.`);
    expect((await get()).defaultDomain).toBe(base.defaultDomain);
  });

  test("(c) an own domain that is still verifying is refused, like creating a link on it", async () => {
    const r = await call(owner.accessToken, "PATCH", "/workspaces/current", { defaultDomain: pending.domain });
    expect(r.status).toBe(400);
    expect(message(r.json)).toContain("isn't verified yet");
    const link = await call(owner.accessToken, "POST", "/links", { destination: "https://example.com/j26", domain: pending.domain });
    expect(link.status, "oracle: link creation refuses the same domain").toBe(400);
    expect((await get()).defaultDomain).toBe(base.defaultDomain);
  });

  test.describe("empty and whitespace", () => {
    for (const [name, value] of [["empty", ""], ["spaces only", "   "]] as const) {
      test(`${name} is a 400`, async () => {
        const r = await call(owner.accessToken, "PATCH", "/workspaces/current", { defaultDomain: value });
        expect(r.status).toBe(400);
        expect(message(r.json)).toBe("Choose a default domain.");
        expect((await get()).defaultDomain).toBe(base.defaultDomain);
      });
    }
  });

  test("(d) typed variants of a valid domain resolve to the stored one; unchanged re-send is harmless", async () => {
    const variant = ` ${verified.domain.toUpperCase()}. `;
    const r = await call(owner.accessToken, "PATCH", "/workspaces/current", { defaultDomain: variant });
    expect(r.status).toBe(200);
    expect((r.json as Workspace).defaultDomain).toBe(verified.domain);

    // Whole-form re-send of the current default alongside another change.
    const again = await call(owner.accessToken, "PATCH", "/workspaces/current", { defaultDomain: verified.domain, currency: "usd" });
    expect(again.status).toBe(200);
    expect((again.json as Workspace).currency).toBe("USD");

    // Put it back for the UI steps.
    const back = await call(owner.accessToken, "PATCH", "/workspaces/current", { defaultDomain: base.defaultDomain, currency: base.currency });
    expect(back.status).toBe(200);
    expect((await get()).defaultDomain).toBe(base.defaultDomain);
  });

  for (const vp of [
    { name: "desktop", size: { width: 1440, height: 900 } },
    { name: "mobile-390", size: { width: 390, height: 844 } },
  ]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`(e) ${vp.name}/${scheme}: the select offers only live domains; choose, save, reload`, async () => {
        await page.setViewportSize(vp.size);
        await page.emulateMedia({ colorScheme: scheme });
        if (!page.url().includes("/settings") && !(await page.evaluate(() => !!window.localStorage.getItem("snapurl.accessToken")).catch(() => false))) {
          await signIn(page, owner.email);
        }
        await page.goto("/settings");
        const select = page.getByLabel("Default domain");
        await expect(select).toBeVisible({ timeout: 20_000 });
        expect(await select.evaluate((n) => n.tagName)).toBe("SELECT");
        await expect(select).toHaveValue(base.defaultDomain);

        const opts = await select.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
        expect(opts).toContain(base.defaultDomain);
        expect(opts).toContain(verified.domain);
        expect(opts, "a verifying domain is not offered").not.toContain(pending.domain);
        expect(opts, "another workspace's domain is not offered").not.toContain(foreign.domain);
        await page.screenshot({ path: path.join(SHOTS, `settings-select-${vp.name}-${scheme}.png`), fullPage: true });

        await select.selectOption(verified.domain);
        const patch = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/workspaces\/current$/.test(r.url()));
        await page.getByRole("button", { name: "Save changes" }).click();
        expect((await patch).status()).toBe(200);
        await expect(page.getByText("Saved.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Discard" })).toHaveCount(0);
        expect((await get()).defaultDomain).toBe(verified.domain);

        await page.reload();
        await expect(page.getByLabel("Default domain")).toHaveValue(verified.domain);
        await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
        await page.screenshot({ path: path.join(SHOTS, `settings-saved-${vp.name}-${scheme}.png`), fullPage: true });

        // restore for the next viewport
        const back = await call(owner.accessToken, "PATCH", "/workspaces/current", { defaultDomain: base.defaultDomain });
        expect(back.status).toBe(200);
      });
    }
  }

  test("(f) a refusal the page can still hit (domain gone stale) is shown under the field", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/settings");
    const select = page.getByLabel("Default domain");
    await expect(select).toHaveValue(base.defaultDomain);
    // Another tab un-verifies the domain after this page loaded its list.
    psql(`update domains set status='failed' where id='${verified.id}'`);
    await select.selectOption(verified.domain);
    await page.getByRole("button", { name: "Save changes" }).click();
    const hint = page.locator("#settings-default-domain-hint");
    await expect(hint).toContainText("isn't verified yet");
    await expect(page.getByText("Saved.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "settings-refused-desktop.png"), fullPage: true });
    expect((await get()).defaultDomain).toBe(base.defaultDomain);
    psql(`update domains set status='live' where id='${verified.id}'`);
  });

  test("(g) a viewer sees the control disabled with the reason, and the API answers 403", async ({ browser }) => {
    const viewerEmail = makeEmail("j26-viewer");
    await registerUser(viewerEmail);
    psql(`update memberships set role='viewer' where lower(email)=lower('${viewerEmail}')`);
    const login = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: viewerEmail, password: RUN_PASSWORD }),
    });
    const viewerToken = ((await login.json()) as { accessToken: string }).accessToken;
    const denied = await call(viewerToken, "PATCH", "/workspaces/current", { defaultDomain: "not-mine.example" });
    expect(denied.status).toBe(403);

    const vp = await browser.newPage();
    try {
      await signIn(vp, viewerEmail);
      await vp.goto("/settings");
      const select = vp.getByLabel("Default domain");
      await expect(select).toBeVisible({ timeout: 20_000 });
      await expect(select).toBeDisabled();
      await expect(vp.getByText("Ask an owner or admin to change the default domain.")).toBeVisible();
      await vp.screenshot({ path: path.join(SHOTS, "settings-viewer-desktop.png"), fullPage: true });
    } finally {
      await vp.close();
    }
  });
});
