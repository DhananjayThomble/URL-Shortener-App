/**
 * Journey 792 — validation errors reach people as plain sentences (#792)  @mobile
 *
 * QA saw raw zod English with a field path in front ("name: Too big: expected
 * string to have <=80 characters") on /register, three contradictory
 * "destination: …" lines for one bad bulk row, "endpoint: That host isn't
 * allowed" on /developers, and "Invalid email address" for an empty
 * /forgot-password box.
 *
 * Oracles: the issue's acceptance criteria — no `field:` prefix, no zod default
 * English, one message per field, "required" (not "invalid") for an empty field,
 * and `maxLength` on inputs that have a server limit. The wording is asserted
 * on the REAL API's responses first (the contract the pages render), then on the
 * pages themselves after real clicks.
 *
 * Register is throttled (5/min): this journey registers exactly one account per
 * project and sends the over-long-name request from the same call that proves
 * the rejection (which the throttle counts, so the order is: reject, then
 * register once).
 */

import { expect, test, type Page } from "@playwright/test";
import { API_URL, RUN_PASSWORD, makeEmail, registerUser, seedAccount } from "./helpers";

const ZOD_ENGLISH = /Too big|Too small|Invalid input|Invalid email address|Invalid option|expected .* to have/;
const FIELD_PREFIX = /\b(name|email|password|destination|endpoint|events|slug|links\.\d+\.\w+): /;

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function expectPlain(text: string) {
  expect(text).not.toMatch(ZOD_ENGLISH);
  expect(text).not.toMatch(FIELD_PREFIX);
}

async function bodyText(page: Page) {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

test.describe("Journey 792 — plain validation copy", () => {
  test("the real API answers with sentences, one per field, no field path @mobile", async ({}, info) => {
    // /register — the exact case from the issue: an 81-character name.
    const over = await post("/auth/register", { name: "n".repeat(81), email: makeEmail(`j792-over-${info.project.name}`), password: RUN_PASSWORD });
    expect(over.status).toBe(400);
    expect(over.json.message).toEqual(["Name must be 80 characters or fewer"]);
    expect(over.json.issues).toEqual([{ path: "name", message: "Name must be 80 characters or fewer" }]);

    // The boundary: exactly 80 is accepted.
    const session = await registerUser(makeEmail(`j792-${info.project.name}`)); // name "Journey Tester" — fine
    expect(session.accessToken).toBeTruthy();

    // /forgot-password submitted empty: required, not invalid.
    const empty = await post("/auth/password-reset/request", { email: "" });
    expect(empty.status).toBe(400);
    expect(empty.json.message).toEqual(["Email is required"]);

    // …and with nothing at all.
    const missing = await post("/auth/password-reset/request", {});
    expect(missing.json.message).toEqual(["Email is required"]);

    // /developers webhook: a private endpoint, and no events — one line each, no `endpoint:`.
    const priv = await post("/webhooks", { endpoint: "http://10.0.0.5/hook", events: ["link.created"] }, session.accessToken);
    expect(priv.status).toBe(400);
    expect(priv.json.message).toEqual(["That host isn't allowed (private, loopback or link-local address)"]);
    const noEvents = await post("/webhooks", { endpoint: "https://example.com/hook", events: [] }, session.accessToken);
    expect(noEvents.json.message).toEqual(["Events must have at least one item"]);

    // A mistyped destination used to produce three contradictory messages.
    const wsRes = await fetch(`${API_URL}/workspaces/current`, { headers: { authorization: `Bearer ${session.accessToken}` } });
    const ws = (await wsRes.json()) as { defaultDomain?: string };
    const bad = await post("/links", { destination: "not-a-url", domain: ws.defaultDomain ?? "localhost:3002" }, session.accessToken);
    expect(bad.status).toBe(400);
    expect(bad.json.message).toEqual(["Enter an absolute http(s) URL"]);

    // Bulk: one bad pasted line is ONE plain sentence on its row.
    const bulk = await post(
      "/links/bulk",
      { links: [{ destination: "not-a-url", domain: ws.defaultDomain ?? "localhost:3002" }] },
      session.accessToken,
    );
    const row = (bulk.json.results as Array<{ ok: boolean; error?: string }>)[0]!;
    expect(row.ok).toBe(false);
    expect(row.error).toBe("Enter an absolute http(s) URL.");

    for (const m of [...(over.json.message as string[]), ...(priv.json.message as string[]), row.error!]) expectPlain(m);
  });

  test("/forgot-password submitted empty says the email is required @mobile", async ({ page }, info) => {
    await page.goto("/forgot-password");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
    expectPlain(await bodyText(page));
    await page.screenshot({ path: info.outputPath(`forgot-empty-${info.project.name}.png`), fullPage: false });
  });

  test("/register: name and password inputs carry the server's limits @mobile", async ({ page }, info) => {
    await page.goto("/register");
    const name = page.getByLabel("Name");
    await expect(name).toHaveAttribute("maxlength", "80");
    await name.fill("n".repeat(120));
    await expect(name).toHaveValue("n".repeat(80));
    await expect(page.getByLabel("Password")).toHaveAttribute("maxlength", "200");
    // Empty submit: client-side messages are human too.
    await name.fill("");
    await page.getByRole("button", { name: "Create account" }).click();
    expectPlain(await bodyText(page));
    await page.screenshot({ path: info.outputPath(`register-${info.project.name}.png`), fullPage: false });
  });

  test("/developers: a private webhook endpoint is refused in plain English @mobile", async ({ page }, info) => {
    const session = await registerUser(makeEmail(`j792-dev-${info.project.name}`));
    await seedAccount(page, session);
    await page.goto("/developers");
    await page.getByRole("button", { name: "＋ Add endpoint" }).click();
    await page.getByPlaceholder("https://example.com/hooks/snapurl").fill("http://10.0.0.5/hook");
    await page.getByRole("button", { name: "Add endpoint", exact: true }).click();
    await expect(page.getByText("That host isn't allowed (private, loopback or link-local address)")).toBeVisible();
    expectPlain(await bodyText(page));
    await page.screenshot({ path: info.outputPath(`developers-${info.project.name}.png`), fullPage: false });
  });

  test("bulk create: a bad line shows one plain sentence on its row @mobile", async ({ page }, info) => {
    const session = await registerUser(makeEmail(`j792-bulk-${info.project.name}`));
    await seedAccount(page, session);
    await page.goto("/links");
    await page.getByRole("button", { name: "Bulk create" }).click();
    await page.getByLabel("One link per line").fill("not a url");
    await page.getByRole("button", { name: "Create 1 link" }).click();
    await expect(page.getByText("Nothing was created.")).toBeVisible({ timeout: 20_000 });
    const row = page.getByRole("listitem").filter({ hasText: "not a url" });
    await expect(row.getByText("Enter an absolute http(s) URL.", { exact: true })).toHaveCount(1);
    expectPlain(await bodyText(page));
    await page.screenshot({ path: info.outputPath(`bulk-${info.project.name}.png`), fullPage: false });
  });
});
