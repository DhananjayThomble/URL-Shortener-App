/**
 * Journey 13 — Edit a link beyond its destination, and archive it (#644)
 *
 * Before #644 the only field PATCH /links/:id was reachable for from the UI
 * was `destination`: a routing rule, password, expiry, UTM, social preview,
 * tags/folder/comment or archiving the link all meant deleting and recreating
 * it (losing click history, freeing the slug). A real user does this:
 *
 *   sign in through the login form -> open a link -> Edit -> change every
 *   field -> Save -> reload -> open Edit again and SEE the saved values.
 *
 * Oracles:
 *   - packages/contract/src/link.ts UpdateLinkInput (CreateLinkInput minus
 *     domain/slug, plus `archived`): every field edited here is one the API
 *     accepts on PATCH.
 *   - The edit drawer re-opened after a full page reload (values come from
 *     GET /links/:id, so a UI that only mutated local state would fail).
 *   - GET /links/:id over HTTP (independent read of what was persisted).
 *   - The redirect service on :3002 for the two settings with a visitor-visible
 *     effect: password (302 to the unlock page) and expiry (410 Gone).
 *
 * Requires the local staging stack (api :3001, redirect :3002) and the web app
 * on :3000 — see playwright.journeys.config.ts.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_PASSWORD, createLink, makeEmail, registerUser, type Session } from "./helpers";

const DEST = "https://example.com/j13-destination";
const NEW_DEST = "https://example.com/j13-new-destination";
const RULE_DEST = "https://example.com/j13-rule-target";
const PASSWORD = "j13-link-password";
const EXPIRES_TO = "https://example.com/j13-expired-landing";
const IMAGE = "https://example.com/j13-og.png";

/** YYYY-MM-DD in the browser's local calendar, `days` from today. */
function dateInput(days: number): string {
  const d = new Date(Date.now() + days * 864e5);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Real sign-in through the login form, as a user would. */
async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function openEditor(page: Page, linkId: string, slug: string): Promise<Locator> {
  await page.goto(`/links/${linkId}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: new RegExp(`Edit .+/${slug}`) });
  await expect(drawer).toBeVisible();
  return drawer;
}

const tab = (drawer: Locator, name: string) => drawer.getByRole("tab", { name, exact: true }).click();
const save = async (drawer: Locator) => {
  await drawer.getByRole("button", { name: "Save changes" }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });
};

async function getLink(session: Session, id: string) {
  const res = await fetch(`${API_URL}/links/${id}`, { headers: { authorization: `Bearer ${session.accessToken}` } });
  expect(res.ok, "GET /links/:id should succeed").toBe(true);
  return (await res.json()) as Record<string, any>;
}

/** What a visitor gets from the redirect service, without following it. */
async function visit(slug: string) {
  const res = await fetch(`${REDIRECT_URL}/${slug}`, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

test.describe("Journey 13 — Full link edit and archive", () => {
  test("edit every field in the drawer, reload, and see each saved value @mobile", async ({ page }) => {
    const session = await registerUser(makeEmail("j13a"));
    const link = await createLink(session.accessToken, { destination: DEST });
    await signIn(page, session);

    const drawer = await openEditor(page, link.id, link.slug);

    /* Destination tab: destination, folder, tags, comment */
    await drawer.getByLabel("Destination URL").fill(NEW_DEST);
    await drawer.getByPlaceholder("Campaigns / Spring 2026").fill("j13-folder");
    await drawer.getByLabel("Tags").fill("j13-alpha, j13-beta");
    await drawer.getByPlaceholder(/What is this link for/).fill("j13 comment");

    /* Routing tab: one country rule, redirect type, deep link, forward-query off */
    await tab(drawer, "Routing");
    await drawer.getByRole("button", { name: /Add rule/i }).click();
    await drawer.getByLabel("Rule 1 condition").selectOption({ label: "Country is" });
    await drawer.getByLabel("Rule 1 country").fill("US");
    await drawer.getByLabel("Rule 1 destination").fill(RULE_DEST);
    await drawer.getByRole("group", { name: "Redirect type" }).getByRole("button", { name: "301" }).click();
    await drawer.getByRole("button", { name: /Forward query parameters/ }).click();

    /* Access tab: expiry (+ landing), click limit, password, referrer, preview */
    await tab(drawer, "Access");
    await drawer.getByRole("button", { name: /Expire on a date/ }).click();
    await drawer.getByLabel("Expiry date").fill(dateInput(10));
    await drawer.getByPlaceholder("acme.com/offers").fill(EXPIRES_TO);
    await drawer.getByRole("button", { name: /Expire after a click limit/ }).click();
    await drawer.getByLabel("Click limit").fill("42");
    await drawer.getByPlaceholder("Leave blank for no password").fill(PASSWORD);
    await drawer.getByRole("button", { name: /Hide the referrer/ }).click();
    await drawer.getByRole("button", { name: /Allow public preview/ }).click();

    /* UTM tab */
    await tab(drawer, "UTM");
    await drawer.getByLabel("utm_source").fill("j13src");
    await drawer.getByLabel("utm_medium").fill("j13med");
    await drawer.getByLabel("utm_campaign").fill("j13camp");
    await drawer.getByLabel("utm_content").fill("j13cont");

    /* Social preview tab */
    await tab(drawer, "Social preview");
    await drawer.getByLabel("Title", { exact: true }).fill("j13 title");
    await drawer.getByLabel("Description", { exact: true }).fill("j13 description");
    await drawer.getByLabel("Image URL").fill(IMAGE);

    /* Save: observe the real PATCH, then the drawer closing */
    const patch = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/links/${link.id}`));
    await save(drawer);
    const body = (await patch).postDataJSON() as Record<string, unknown>;
    for (const key of [
      "destination", "folder", "tags", "comment", "rules", "redirectType", "forwardQuery", "expiresAt",
      "expiresTo", "clickLimit", "password", "hideReferrer", "publicPreview", "utm", "social", "archived",
    ]) {
      expect(body, `PATCH body should carry "${key}"`).toHaveProperty(key);
    }

    /* Independent read of what the API stored */
    const stored = await getLink(session, link.id);
    expect(stored.destination).toBe(NEW_DEST);
    expect(stored.folder).toBe("j13-folder");
    expect(stored.tags).toEqual(["j13-alpha", "j13-beta"]);
    expect(stored.comment).toBe("j13 comment");
    expect(stored.rules).toEqual([expect.objectContaining({ then: RULE_DEST, when: expect.objectContaining({ country: "US" }) })]);
    expect(stored.redirectType).toBe("301");
    expect(stored.forwardQuery).toBe(false);
    expect(stored.expiresTo).toBe(EXPIRES_TO);
    expect(stored.clickLimit).toBe(42);
    expect(stored.passwordProtected).toBe(true);
    expect(stored.hideReferrer).toBe(true);
    expect(stored.publicPreview).toBe(false);
    expect(stored.utm).toMatchObject({ source: "j13src", medium: "j13med", campaign: "j13camp", content: "j13cont" });
    expect(stored.social).toMatchObject({ title: "j13 title", description: "j13 description", image: IMAGE });

    /* RELOAD, reopen the editor: every saved value is shown */
    const again = await openEditor(page, link.id, link.slug);
    await expect(again.getByLabel("Destination URL")).toHaveValue(NEW_DEST);
    await expect(again.getByPlaceholder("Campaigns / Spring 2026")).toHaveValue("j13-folder");
    await expect(again.getByLabel("Tags")).toHaveValue("j13-alpha, j13-beta");
    await expect(again.getByPlaceholder(/What is this link for/)).toHaveValue("j13 comment");

    await tab(again, "Routing");
    await expect(again.getByLabel("Rule 1 country")).toHaveValue("US");
    await expect(again.getByLabel("Rule 1 destination")).toHaveValue(RULE_DEST);
    await expect(again.getByRole("group", { name: "Redirect type" }).getByRole("button", { name: "301" })).toHaveAttribute("aria-pressed", "true");
    await expect(again.getByRole("button", { name: /Forward query parameters/ })).toHaveAttribute("aria-pressed", "false");

    await tab(again, "Access");
    await expect(again.getByRole("button", { name: /Expire on a date/ })).toHaveAttribute("aria-pressed", "true");
    await expect(again.getByLabel("Expiry date")).toHaveValue(dateInput(10));
    await expect(again.getByPlaceholder("acme.com/offers")).toHaveValue(EXPIRES_TO);
    await expect(again.getByLabel("Click limit")).toHaveValue("42");
    await expect(again.getByRole("button", { name: /Remove password/ })).toBeVisible(); // only shown when a password is set
    await expect(again.getByRole("button", { name: /Hide the referrer/ })).toHaveAttribute("aria-pressed", "true");
    await expect(again.getByRole("button", { name: /Allow public preview/ })).toHaveAttribute("aria-pressed", "false");

    await tab(again, "UTM");
    await expect(again.getByLabel("utm_source")).toHaveValue("j13src");
    await expect(again.getByLabel("utm_medium")).toHaveValue("j13med");
    await expect(again.getByLabel("utm_campaign")).toHaveValue("j13camp");
    await expect(again.getByLabel("utm_content")).toHaveValue("j13cont");

    await tab(again, "Social preview");
    await expect(again.getByLabel("Title", { exact: true })).toHaveValue("j13 title");
    await expect(again.getByLabel("Description", { exact: true })).toHaveValue("j13 description");
    await expect(again.getByLabel("Image URL")).toHaveValue(IMAGE);

    /* Saving the reopened, untouched form must not wipe the password it cannot see */
    await save(again);
    expect((await getLink(session, link.id)).passwordProtected, "blank password field must leave the password alone").toBe(true);

    /* The detail page itself shows the new destination and the rule */
    await expect(page.getByText(NEW_DEST).first()).toBeVisible();
  });

  test("clearing optional values removes them (UTM, preview, rule, tags)", async ({ page }) => {
    const session = await registerUser(makeEmail("j13b"));
    const link = await createLink(session.accessToken, { destination: DEST });
    // Seed values over the API, then remove them through the UI.
    const seed = await fetch(`${API_URL}/links/${link.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        tags: ["gone"],
        utm: { source: "gone" },
        social: { title: "gone", image: IMAGE },
        rules: [{ id: "j13-seed-rule", when: { country: "US" }, then: RULE_DEST }],
        expiresAt: new Date(Date.now() + 5 * 864e5).toISOString(),
        expiresTo: EXPIRES_TO,
        password: PASSWORD,
      }),
    });
    expect(seed.ok, `seed PATCH: ${seed.status}`).toBe(true);

    await signIn(page, session);
    const drawer = await openEditor(page, link.id, link.slug);
    await drawer.getByLabel("Tags").fill("");
    await tab(drawer, "Routing");
    await drawer.getByRole("button", { name: "Remove rule 1" }).click();
    await tab(drawer, "Access");
    await drawer.getByRole("button", { name: /Expire on a date/ }).click(); // off
    await drawer.getByPlaceholder("acme.com/offers").fill("");
    await drawer.getByRole("button", { name: /Remove password/ }).click();
    await tab(drawer, "UTM");
    await drawer.getByLabel("utm_source").fill("");
    await tab(drawer, "Social preview");
    await drawer.getByLabel("Title", { exact: true }).fill("");
    await drawer.getByLabel("Image URL").fill("");
    await save(drawer);

    const stored = await getLink(session, link.id);
    expect(stored.tags).toEqual([]);
    expect(stored.rules).toEqual([]);
    expect(stored.expiresAt ?? null).toBeNull();
    expect(stored.expiresTo ?? null).toBeNull();
    expect(stored.passwordProtected).toBe(false);
    expect(stored.utm?.source ?? null).toBeNull();
    expect(stored.social?.title ?? null).toBeNull();
    expect(stored.social?.image ?? null).toBeNull();
  });

  test("password and expiry edits change what a visitor gets from the redirect service", async ({ page }) => {
    const session = await registerUser(makeEmail("j13c"));
    const link = await createLink(session.accessToken, { destination: DEST });
    await signIn(page, session);

    await expect
      .poll(async () => (await visit(link.slug)).location, { message: "baseline: plain redirect", timeout: 30_000 })
      .toContain("example.com/j13-destination");

    // 1. Set a password in the UI -> visitors are sent to the unlock page.
    let drawer = await openEditor(page, link.id, link.slug);
    await tab(drawer, "Access");
    await drawer.getByPlaceholder("Leave blank for no password").fill(PASSWORD);
    await save(drawer);
    await expect
      .poll(async () => (await visit(link.slug)).location, { message: "password set -> unlock page", timeout: 30_000 })
      .toContain(`/p/${link.slug}`);

    // 2. Remove it in the UI -> straight to the destination again.
    drawer = await openEditor(page, link.id, link.slug);
    await tab(drawer, "Access");
    await drawer.getByRole("button", { name: /Remove password/ }).click();
    await save(drawer);
    await expect
      .poll(async () => (await visit(link.slug)).location, { message: "password removed -> destination", timeout: 30_000 })
      .toContain("example.com/j13-destination");

    // 3. Expire it (yesterday) in the UI -> 410 Gone.
    drawer = await openEditor(page, link.id, link.slug);
    await tab(drawer, "Access");
    await drawer.getByRole("button", { name: /Expire on a date/ }).click();
    await drawer.getByLabel("Expiry date").fill(dateInput(-1));
    await save(drawer);
    await expect
      .poll(async () => (await visit(link.slug)).status, { message: "expired -> 410", timeout: 30_000 })
      .toBe(410);

    // 4. Move the expiry into the future -> live again, and the date is shown.
    drawer = await openEditor(page, link.id, link.slug);
    await tab(drawer, "Access");
    await expect(drawer.getByLabel("Expiry date")).toHaveValue(dateInput(-1));
    await drawer.getByLabel("Expiry date").fill(dateInput(30));
    await save(drawer);
    await expect
      .poll(async () => (await visit(link.slug)).location, { message: "future expiry -> destination", timeout: 30_000 })
      .toContain("example.com/j13-destination");
  });

  test("archive and unarchive from the drawer and the row moves the link in and out of the Archived filter", async ({ page }) => {
    const session = await registerUser(makeEmail("j13d"));
    const link = await createLink(session.accessToken, { destination: DEST });
    await signIn(page, session);

    /* Drawer: toggle Archived, save */
    const drawer = await openEditor(page, link.id, link.slug);
    await drawer.getByRole("button", { name: /^Archived/ }).click();
    await save(drawer);
    expect((await getLink(session, link.id)).status).toBe("archived");
    await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible();

    /* Archived filter lists it; the default list does not */
    await page.goto("/links");
    await expect(page.locator("article", { hasText: link.slug })).toHaveCount(0);
    await page.getByRole("button", { name: "Archived" }).click();
    const row = page.locator("article", { hasText: link.slug });
    await expect(row).toBeVisible({ timeout: 15_000 });

    /* Row action: unarchive -> leaves the Archived filter */
    await row.getByRole("button", { name: new RegExp(`Unarchive link .+/${link.slug}`) }).click();
    await expect(page.locator("article", { hasText: link.slug })).toHaveCount(0, { timeout: 15_000 });
    expect((await getLink(session, link.id)).status).not.toBe("archived");

    /* Row action: archive again -> appears in the Archived filter */
    await page.getByRole("button", { name: "All" }).click();
    const active = page.locator("article", { hasText: link.slug });
    await expect(active).toBeVisible({ timeout: 15_000 });
    await active.getByRole("button", { name: new RegExp(`Archive link .+/${link.slug}`) }).click();
    await expect(page.locator("article", { hasText: link.slug })).toHaveCount(0, { timeout: 15_000 });
    expect((await getLink(session, link.id)).status).toBe("archived");
  });
});
