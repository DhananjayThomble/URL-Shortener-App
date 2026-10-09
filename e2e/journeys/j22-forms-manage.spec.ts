/**
 * Journey 22 — manage a form from the dashboard (#649)
 *
 * A user signs in through the real login form and does everything a form owner
 * needs WITHOUT touching the API by hand: create a form, see it live at its
 * public /f/<slug> address, collect a response, edit it, close it, delete it.
 *
 * Oracles (not the implementation):
 *   - /forms page copy: "Shareable forms with a response table and CSV export.
 *     Each one lives at /f/its-address." + issue #649 acceptance criteria.
 *   - packages/contract/src/form.ts — CreateFormInput (title min 1 with the
 *     message "Give the form a title.", slug charset, status draft/live/closed,
 *     fields), UpdateFormInput (no slug), Form.
 *   - apps/api public route contract: a form that is not `live` is "not found"
 *     at GET/POST /public/forms/:slug (documented in PublicController: "A draft
 *     or closed form 404s here rather than 403ing").
 *   - Invariant: one public submission => one row in the dashboard responses.
 *
 * One password sign-in (login throttle). Requires the local staging stack
 * (api :3001, Postgres :5435) and the web app on :3000.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { API_URL, RUN_ID, RUN_PASSWORD, TOKEN_KEY, makeEmail, registerUser } from "./helpers";

const slug = `j22-${RUN_ID}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
const TITLE = `J22 feedback ${RUN_ID}`;
const TITLE_2 = `J22 renamed ${RUN_ID}`;

test.describe.serial("Journey 22 — manage forms from the dashboard (#649)", () => {
  let context: BrowserContext;
  let page: Page;

  const accessToken = () => page.evaluate((k) => window.localStorage.getItem(k) ?? "", TOKEN_KEY);
  const listForms = async () => {
    const res = await page.request.get(`${API_URL}/forms`, {
      headers: { authorization: `Bearer ${await accessToken()}` },
    });
    expect(res.status()).toBe(200);
    return (await res.json()) as Array<{ id: string; slug: string; title: string; status: string; fields: Array<{ key: string; label: string }> }>;
  };

  test.beforeAll(async ({ browser }, testInfo) => {
    const email = makeEmail("j22");
    await registerUser(email);
    context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill(email);
    await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/links$/, { timeout: 20_000 });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("empty state offers a create control; the drawer opens, Escape closes it and focus returns", async () => {
    await page.goto("/forms");
    await expect(page.getByRole("heading", { name: "No forms yet" })).toBeVisible({ timeout: 15_000 });

    const emptyCreate = page.getByRole("button", { name: "Create a form" });
    await expect(emptyCreate).toBeVisible();
    // The page header carries one too, so it is reachable once forms exist.
    await expect(page.getByRole("button", { name: "New form" })).toBeVisible();

    await emptyCreate.click();
    const dialog = page.getByRole("dialog", { name: "Create a form" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Title")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(emptyCreate).toBeFocused();
  });

  test("an empty title is refused in the browser with the contract's message, and nothing is sent", async () => {
    let posts = 0;
    const onReq = (r: { method(): string; url(): string }) => {
      if (r.method() === "POST" && /\/api\/v1\/forms$/.test(r.url())) posts++;
    };
    page.on("request", onReq);

    await page.getByRole("button", { name: "New form" }).click();
    const dialog = page.getByRole("dialog", { name: "Create a form" });
    await dialog.getByRole("button", { name: "Create form" }).click();
    await expect(dialog.getByText("Give the form a title.")).toBeVisible();
    await expect(dialog.getByLabel("Title")).toHaveAttribute("aria-invalid", "true");

    // A bad address is refused per field too (contract slug regex).
    await dialog.getByLabel("Title").fill("x");
    await dialog.getByLabel("Address").fill("has space");
    await dialog.getByRole("button", { name: "Create form" }).click();
    await expect(dialog.getByText("Use letters, numbers, dots, dashes or underscores")).toBeVisible();

    page.off("request", onReq);
    expect(posts, "no POST /forms for an invalid draft").toBe(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("create a live form with a required field through the UI", async () => {
    await page.getByRole("button", { name: "New form" }).click();
    const dialog = page.getByRole("dialog", { name: "Create a form" });
    await dialog.getByLabel("Title").fill(TITLE);
    await dialog.getByLabel("Description").fill("Tell us how it went.");
    await dialog.getByLabel("Address").fill(slug);
    await dialog.getByRole("group", { name: "Status" }).getByRole("button", { name: "Live" }).click();

    await dialog.getByRole("button", { name: "Add a field" }).click();
    await dialog.getByLabel("Field 1 label").fill("Your name");
    await dialog.getByLabel("Field 1 type").selectOption("text");
    await dialog.getByLabel("Field 1 required").check();

    const [res] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/v1\/forms$/.test(r.url())),
      dialog.getByRole("button", { name: "Create form" }).click(),
    ]);
    expect(res.status()).toBe(201);
    await expect(dialog).toHaveCount(0);

    const row = page.getByRole("row", { name: new RegExp(TITLE) });
    await expect(row).toBeVisible();
    await expect(row.getByText(`/f/${slug}`)).toBeVisible();
    // The status chip (a <span>) and the row's status picker both say so.
    await expect(row.locator("span", { hasText: /^Live$/ })).toBeVisible();
    await expect(row.getByLabel(`Status of ${TITLE}`)).toHaveValue("live");

    const created = (await listForms()).find((f) => f.slug === slug);
    expect(created?.title).toBe(TITLE);
    expect(created?.status).toBe("live");
    expect(created?.fields.map((f) => f.label)).toEqual(["Your name"]);
  });

  test("the public page shows it, accepts a response, and the response appears in the dashboard", async () => {
    const pub = await context.newPage();
    await pub.goto(`/f/${slug}`);
    await expect(pub.getByRole("heading", { name: TITLE })).toBeVisible({ timeout: 15_000 });
    const answer = `j22-answer-${RUN_ID}`;
    await pub.getByLabel(/Your name/).fill(answer);
    await pub.getByRole("button", { name: "Submit" }).click();
    await expect(pub.getByText("Thanks — that's been recorded.")).toBeVisible();
    await pub.close();

    await page.reload();
    const row = page.getByRole("row", { name: new RegExp(TITLE) });
    await expect(row.getByRole("cell", { name: "1", exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Responses" }).click();
    await expect(page.getByRole("cell", { name: answer })).toBeVisible();
  });

  test("edit the title and a field label; the public page reflects both and the answer key is kept", async () => {
    const before = (await listForms()).find((f) => f.slug === slug)!;
    await page.getByRole("button", { name: `Edit ${TITLE}` }).click();
    const dialog = page.getByRole("dialog", { name: `Edit ${TITLE}` });
    await expect(dialog.getByLabel("Title")).toHaveValue(TITLE);
    await expect(dialog.getByLabel("Field 1 label")).toHaveValue("Your name");
    // The address is fixed once created (UpdateFormInput omits slug).
    await expect(dialog.getByLabel("Address")).toHaveCount(0);

    await dialog.getByLabel("Title").fill(TITLE_2);
    await dialog.getByLabel("Field 1 label").fill("Full name");
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/forms/${before.id}`)),
      dialog.getByRole("button", { name: "Save changes" }).click(),
    ]);
    expect(res.status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("row", { name: new RegExp(TITLE_2) })).toBeVisible();

    const after = (await listForms()).find((f) => f.slug === slug)!;
    expect(after.title).toBe(TITLE_2);
    expect(after.fields[0]!.label).toBe("Full name");
    expect(after.fields[0]!.key, "a field's key is frozen at creation").toBe(before.fields[0]!.key);

    const pub = await context.newPage();
    await pub.goto(`/f/${slug}`);
    await expect(pub.getByRole("heading", { name: TITLE_2 })).toBeVisible({ timeout: 15_000 });
    await expect(pub.getByLabel(/Full name/)).toBeVisible();
    await pub.close();
  });

  test("closing the form from the list makes the public page unavailable and rejects submissions", async () => {
    const row = page.getByRole("row", { name: new RegExp(TITLE_2) });
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/v1\/forms\//.test(r.url())),
      row.getByLabel(`Status of ${TITLE_2}`).selectOption("closed"),
    ]);
    expect(res.status()).toBe(200);
    await expect(row.locator("span", { hasText: /^Closed$/ })).toBeVisible();
    expect((await listForms()).find((f) => f.slug === slug)?.status).toBe("closed");

    const pub = await context.newPage();
    await pub.goto(`/f/${slug}`);
    await expect(pub.getByRole("heading", { name: "There's no form here" })).toBeVisible({ timeout: 15_000 });
    await pub.close();

    const submit = await page.request.post(`${API_URL}/public/forms/${slug}`, { data: { answers: { x: "y" } } });
    expect(submit.status()).toBe(404);
  });

  test("delete asks first, then removes the form from the list and its public address", async () => {
    await page.getByRole("button", { name: `Delete ${TITLE_2}` }).click();
    // Confirm step: nothing is deleted until the user says so.
    await expect(page.getByText(/cannot be undone/)).toBeVisible();
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("row", { name: new RegExp(TITLE_2) })).toBeVisible();
    expect((await listForms()).some((f) => f.slug === slug)).toBe(true);

    await page.getByRole("button", { name: `Delete ${TITLE_2}` }).click();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "DELETE" && /\/api\/v1\/forms\//.test(r.url())),
      page.getByRole("button", { name: "Delete for good" }).click(),
    ]);
    expect(res.status()).toBe(204);
    await expect(page.getByRole("row", { name: new RegExp(TITLE_2) })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "No forms yet" })).toBeVisible();
    expect((await listForms()).some((f) => f.slug === slug)).toBe(false);

    const pubGet = await page.request.get(`${API_URL}/public/forms/${slug}`);
    expect(pubGet.status()).toBe(404);
    const pub = await context.newPage();
    await pub.goto(`/f/${slug}`);
    await expect(pub.getByRole("heading", { name: "There's no form here" })).toBeVisible({ timeout: 15_000 });
    await pub.close();
  });
});
