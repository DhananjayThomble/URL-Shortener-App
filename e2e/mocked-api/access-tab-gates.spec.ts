import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, fakeAccessToken, mockApi, seedMockSession, type MockApi } from "../support/mock-api";

/* E2E (#759): the Access tab of the New link / Edit link drawers.

   1. The two "send visitors to" fields showed scheme-less examples (`acme.com/coming-soon`,
      `acme.com/offers`). Typed verbatim they are refused by the contract's HttpUrl guard
      ("Enter an absolute http(s) URL"). Every placeholder must be a value the form accepts.
   2. With its switch OFF, the Click limit input was disabled while the date inputs and the two
      "send visitors to" inputs stayed enabled: one tab, two conventions. Every input that hangs
      off a switch is now disabled (attribute, look, and an aria link to its switch) while the
      switch is off, and a value typed behind an off switch is not sent.
   3. Switching a gate back on gives back the value it had.

   Mocked-API lane: the assertion that matters is the exact body the browser sends in
   POST /links / PATCH /links/:id (the contract's CreateLinkInput / UpdateLinkInput).
   Oracle for the redirect meaning of the fields: apps/redirect/src/main.ts (blocked ===
   "scheduled" -> scheduledTo, blocked === "expired" -> expiresTo; a click limit is its own
   "click_limit" gate that never reads expiresTo). The real-API round trip is journey
   j759-access-tab-gates.spec.ts. */

const SLUG = "gated";
const NOW = "2026-01-01T00:00:00.000Z";

function link(over: Record<string, unknown> = {}) {
  return {
    id: "lnk_1",
    domain: "snap.to",
    slug: SLUG,
    destination: "https://example.com/start",
    tags: [] as string[],
    status: "active",
    clicks: 0,
    redirectType: "302",
    rules: [],
    passwordProtected: false,
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
    cloaked: false,
    safeBrowsing: { status: "clean", checkedAt: NOW },
    sparkline: Array.from({ length: 30 }, () => 0),
    createdAt: NOW,
    clickLimit: null as number | null,
    expiresAt: null as string | null,
    expiresTo: null as string | null,
    activatesAt: null as string | null,
    scheduledTo: null as string | null,
    ...over,
  };
}

async function installApi(page: Page, initial: ReturnType<typeof link>[] = []): Promise<MockApi> {
  const store = [...initial];
  await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
  return mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /auth/workspaces": {
      status: 200,
      body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
    },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /domains": {
      status: 200,
      body: [
        { id: "dom_1", domain: "snap.to", status: "live", ssl: "active", links: 0, rootRedirect: null, notFoundRedirect: null, shared: true },
      ],
    },
    "GET /members": { status: 200, body: [] },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /links": () => ({ status: 200, body: { items: store, total: store.length, nextCursor: null } }),
    "GET /links/lnk_1": () => ({ status: 200, body: store[0] }),
    "POST /links": (req) => {
      const input = req.body as { slug?: string };
      const created = link({ id: `lnk_${store.length + 1}`, ...(req.body as object), slug: input.slug || "auto" });
      store.unshift(created);
      return { status: 201, body: created };
    },
    "PATCH /links/lnk_1": (req) => {
      store[0] = { ...store[0], ...(req.body as object) };
      return { status: 200, body: store[0] };
    },
  });
}

/* ---- the Access tab's controls ---- */
const goLiveSwitch = (d: Locator) => d.getByRole("button", { name: /Go live on a date/ });
const expireSwitch = (d: Locator) => d.getByRole("button", { name: /Expire on a date/ });
const limitSwitch = (d: Locator) => d.getByRole("button", { name: /Expire after a click limit/ });
const goLiveDate = (d: Locator) => d.getByLabel("Go live on", { exact: true });
const scheduledTo = (d: Locator) => d.getByLabel("Until then, send visitors to");
const expiryDate = (d: Locator) => d.getByLabel("Expiry date", { exact: true });
const expiresTo = (d: Locator) => d.getByLabel("Then send visitors to");
const clickLimit = (d: Locator) => d.getByLabel("Click limit", { exact: true });
const password = (d: Locator) => d.getByLabel("Password", { exact: true });

/** Every input that hangs off a switch, with the switch that gates it. */
const gated = [
  { name: "Go live on", input: goLiveDate, sw: goLiveSwitch },
  { name: "Until then, send visitors to", input: scheduledTo, sw: goLiveSwitch },
  { name: "Expiry date", input: expiryDate, sw: expireSwitch },
  { name: "Then send visitors to", input: expiresTo, sw: expireSwitch },
  { name: "Click limit", input: clickLimit, sw: limitSwitch },
] as const;

const saveEdit = (d: Locator) => d.getByRole("button", { name: "Save changes" });
const saveCreate = (d: Locator) => d.getByRole("button", { name: "Create link" });

async function openCreate(page: Page): Promise<Locator> {
  await page.goto("/links");
  await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "Create a link" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Destination URL").fill("https://example.com/landing");
  await drawer.getByLabel("Short link").fill("new-gated");
  await drawer.getByRole("tab", { name: "Access", exact: true }).click();
  return drawer;
}

async function openEdit(page: Page): Promise<Locator> {
  await page.goto("/links/lnk_1");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: new RegExp(`Edit .+/${SLUG}`) });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("tab", { name: "Access", exact: true }).click();
  return drawer;
}

/** YYYY-MM-DD in the browser's local calendar, `days` from today. */
function dateInput(days: number): string {
  const d = new Date(Date.now() + days * 864e5);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* The element the input's aria-describedby points at: the error (or help) text under it. */
async function describedText(input: Locator, drawer: Locator): Promise<string | null> {
  const id = await input.getAttribute("aria-describedby");
  return id ? drawer.locator(`[id="${id}"]`).textContent() : null;
}

/** Force a theme before the app boots (app/layout.tsx's pre-paint script reads this key). */
async function seedTheme(page: Page, mode: "light" | "dark") {
  await page.addInitScript(
    ([key, m]) => window.localStorage.setItem(key, JSON.stringify({ mode: m })),
    ["snapurl.appearance", mode] as const,
  );
}

const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];
const viewports = [
  { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  { name: "mobile (Pixel 7, 412px)", use: pixel7 },
] as const;

for (const vp of viewports) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`Access tab gates — ${vp.name} — ${theme}`, () => {
      test.use(vp.use);
      test.beforeEach(async ({ page }) => {
        await seedTheme(page, theme);
      });

      test("the URL placeholders are valid http(s) URLs, and typing one verbatim creates the link", async ({ page }) => {
        const api = await installApi(page);
        const drawer = await openCreate(page);
        await goLiveSwitch(drawer).click();
        await expireSwitch(drawer).click();

        const soon = await scheduledTo(drawer).getAttribute("placeholder");
        const gone = await expiresTo(drawer).getAttribute("placeholder");
        for (const p of [soon, gone]) {
          expect(p, "placeholder").toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/\S+$/);
          expect(() => new URL(p!)).not.toThrow();
        }

        await scheduledTo(drawer).fill(soon!);
        await expiresTo(drawer).fill(gone!);
        await saveCreate(drawer).click();
        await expect(drawer).toBeHidden(); // no "Enter an absolute http(s) URL" -> it was accepted
        const body = api.callsTo("POST", "/links")[0].body as Record<string, unknown>;
        expect(body.scheduledTo).toBe(soon);
        expect(body.expiresTo).toBe(gone);
      });

      test("with every switch off, every gated input is disabled the same way; Password is not gated and stays enabled", async ({ page }) => {
        await installApi(page);
        const drawer = await openCreate(page);

        for (const g of gated) {
          const input = g.input(drawer);
          await expect(input, g.name).toBeDisabled();
          await expect(g.sw(drawer), `${g.name} switch`).toHaveAttribute("aria-pressed", "false");
          // the switch names the input it controls
          const id = await input.getAttribute("id");
          expect(id, `${g.name} has an id`).toBeTruthy();
          expect((await g.sw(drawer).getAttribute("aria-controls")) ?? "", `${g.name} switch aria-controls`).toContain(id!);
          // one visual convention for "off": dimmed and a not-allowed cursor
          await expect(input, `${g.name} look`).toHaveCSS("cursor", "not-allowed");
          expect(Number(await input.evaluate((el) => getComputedStyle(el).opacity)), `${g.name} opacity`).toBeLessThan(1);
        }
        // an enabled input is not dimmed
        await expect(password(drawer)).toBeEnabled();
        await expect(password(drawer)).not.toHaveCSS("cursor", "not-allowed");

        // the text inputs say what to do, in one phrase
        for (const g of [gated[1], gated[3], gated[4]]) {
          const placeholder = (await g.input(drawer).getAttribute("placeholder")) ?? "";
          expect(placeholder, g.name).toBe("Turn on the switch above");
        }
      });

      test("each switch enables exactly its own inputs, and switching it off disables them again", async ({ page }) => {
        await installApi(page);
        const drawer = await openCreate(page);
        const groups = [
          { sw: goLiveSwitch, on: [goLiveDate, scheduledTo], off: [expiryDate, expiresTo, clickLimit] },
          { sw: expireSwitch, on: [expiryDate, expiresTo], off: [goLiveDate, scheduledTo, clickLimit] },
          { sw: limitSwitch, on: [clickLimit], off: [goLiveDate, scheduledTo, expiryDate, expiresTo] },
        ];
        for (const grp of groups) {
          await grp.sw(drawer).click();
          await expect(grp.sw(drawer)).toHaveAttribute("aria-pressed", "true");
          for (const f of grp.on) await expect(f(drawer)).toBeEnabled();
          for (const f of grp.off) await expect(f(drawer)).toBeDisabled();
          await grp.sw(drawer).click();
          for (const f of grp.on) await expect(f(drawer)).toBeDisabled();
        }
      });

      test("a value is kept while its switch is off and comes back when it is switched on again", async ({ page }) => {
        await installApi(page);
        const drawer = await openCreate(page);

        await goLiveSwitch(drawer).click();
        await goLiveDate(drawer).fill(dateInput(3));
        await scheduledTo(drawer).fill("https://example.com/soon");
        await expireSwitch(drawer).click();
        await expiryDate(drawer).fill(dateInput(12));
        await expiresTo(drawer).fill("https://example.com/gone");
        await limitSwitch(drawer).click();
        await clickLimit(drawer).fill("42");

        // all off: the dates read empty and disabled, the typed URLs stay visible (dimmed)
        for (const sw of [goLiveSwitch, expireSwitch, limitSwitch]) await sw(drawer).click();
        await expect(goLiveDate(drawer)).toHaveValue("");
        await expect(expiryDate(drawer)).toHaveValue("");
        await expect(clickLimit(drawer)).toHaveValue("");
        await expect(scheduledTo(drawer)).toHaveValue("https://example.com/soon");
        await expect(expiresTo(drawer)).toHaveValue("https://example.com/gone");

        // a trip to another tab and back changes nothing
        await drawer.getByRole("tab", { name: "Routing", exact: true }).click();
        await drawer.getByRole("tab", { name: "Access", exact: true }).click();
        await expect(scheduledTo(drawer)).toHaveValue("https://example.com/soon");
        await expect(scheduledTo(drawer)).toBeDisabled();

        // all back on: exactly what was there before
        for (const sw of [goLiveSwitch, expireSwitch, limitSwitch]) await sw(drawer).click();
        await expect(goLiveDate(drawer)).toHaveValue(dateInput(3));
        await expect(scheduledTo(drawer)).toHaveValue("https://example.com/soon");
        await expect(expiryDate(drawer)).toHaveValue(dateInput(12));
        await expect(expiresTo(drawer)).toHaveValue("https://example.com/gone");
        await expect(clickLimit(drawer)).toHaveValue("42");
      });

      test("a value typed behind an off switch is not sent, and cannot block the save", async ({ page }) => {
        const api = await installApi(page);
        const drawer = await openCreate(page);
        await expireSwitch(drawer).click();
        await expiryDate(drawer).fill(dateInput(9));
        await expiresTo(drawer).fill("not a url"); // junk ...
        await expireSwitch(drawer).click(); // ... and then the expiry is switched off
        await goLiveSwitch(drawer).click();
        await scheduledTo(drawer).fill("https://example.com/soon");
        await goLiveSwitch(drawer).click();

        await saveCreate(drawer).click();
        await expect(drawer).toBeHidden();
        const body = api.callsTo("POST", "/links")[0].body as Record<string, unknown>;
        expect(body.expiresTo ?? null).toBeNull();
        expect(body.scheduledTo ?? null).toBeNull();
        expect(body.expiresAt ?? null).toBeNull();
        expect(body.activatesAt ?? null).toBeNull();
      });

      test("switching the switch off clears the URL error it was showing", async ({ page }) => {
        const api = await installApi(page);
        const drawer = await openCreate(page);
        await expireSwitch(drawer).click();
        await expiresTo(drawer).fill("acme.com/offers"); // the scheme-less value the old placeholder invited
        await saveCreate(drawer).click();
        await expect(expiresTo(drawer)).toHaveAttribute("aria-invalid", "true");
        expect(await describedText(expiresTo(drawer), drawer)).toContain("absolute http(s) URL");
        expect(api.callsTo("POST", "/links")).toHaveLength(0);

        await expireSwitch(drawer).click();
        await expect(expiresTo(drawer)).not.toHaveAttribute("aria-invalid", "true");
        await expect(drawer.getByText("Enter an absolute http(s) URL")).toHaveCount(0);
        await expect(drawer.getByRole("tab", { name: /Access \(has an error\)/ })).toHaveCount(0);
        await saveCreate(drawer).click();
        await expect(drawer).toBeHidden();
        expect(api.callsTo("POST", "/links")).toHaveLength(1);
      });

      test("edit: a link with no dates and no limit opens with every gated input disabled; an unchanged save sends them as null", async ({ page }) => {
        const api = await installApi(page, [link()]);
        const drawer = await openEdit(page);
        for (const g of gated) await expect(g.input(drawer), g.name).toBeDisabled();
        await saveEdit(drawer).click();
        await expect(drawer).toBeHidden();
        const body = api.callsTo("PATCH", "/links/lnk_1")[0].body as Record<string, unknown>;
        for (const k of ["expiresAt", "expiresTo", "activatesAt", "scheduledTo", "clickLimit"]) expect(body[k] ?? null, k).toBeNull();
      });

      test("edit: a link with dates opens with its gated inputs enabled and filled; switching off removes the dates AND their URLs", async ({ page }) => {
        const api = await installApi(page, [
          link({
            activatesAt: "2030-01-10T00:00:00.000Z",
            scheduledTo: "https://example.com/soon",
            expiresAt: "2030-02-10T23:59:59.999Z",
            expiresTo: "https://example.com/gone",
            clickLimit: 500,
          }),
        ]);
        const drawer = await openEdit(page);
        for (const g of gated) await expect(g.input(drawer), g.name).toBeEnabled();
        await expect(scheduledTo(drawer)).toHaveValue("https://example.com/soon");
        await expect(expiresTo(drawer)).toHaveValue("https://example.com/gone");

        await expireSwitch(drawer).click();
        await goLiveSwitch(drawer).click();
        await expect(expiresTo(drawer)).toBeDisabled();
        await expect(scheduledTo(drawer)).toBeDisabled();
        await saveEdit(drawer).click();
        await expect(drawer).toBeHidden();
        const body = api.callsTo("PATCH", "/links/lnk_1")[0].body as Record<string, unknown>;
        expect(body.expiresAt).toBeNull();
        expect(body.expiresTo).toBeNull(); // not left behind on the link
        expect(body.activatesAt).toBeNull();
        expect(body.scheduledTo).toBeNull();
        expect(body.clickLimit).toBe(500); // the click limit's own gate was not touched
      });

      test("edit: switching an expiry off and on again restores the link's own expiry and URL, not a new default", async ({ page }) => {
        const iso = "2030-02-10T12:00:00.000Z";
        const api = await installApi(page, [link({ expiresAt: iso, expiresTo: "https://example.com/gone" })]);
        const drawer = await openEdit(page);
        const before = await expiryDate(drawer).inputValue();
        expect(before).toMatch(/^2030-02-(09|10|11)$/); // the viewer's calendar day of that instant
        await expireSwitch(drawer).click();
        await expireSwitch(drawer).click();
        await expect(expiryDate(drawer)).toHaveValue(before);
        await expect(expiresTo(drawer)).toHaveValue("https://example.com/gone");
        await saveEdit(drawer).click();
        await expect(drawer).toBeHidden();
        const body = api.callsTo("PATCH", "/links/lnk_1")[0].body as Record<string, unknown>;
        expect(body.expiresAt).toBe(iso); // byte-for-byte what the server had
        expect(body.expiresTo).toBe("https://example.com/gone");
      });

      test("a fresh drawer does not inherit a remembered value from the previous one", async ({ page }) => {
        await installApi(page);
        let drawer = await openCreate(page);
        await expireSwitch(drawer).click();
        await expiryDate(drawer).fill(dateInput(12));
        await expireSwitch(drawer).click(); // off: remembered inside THIS drawer
        await drawer.getByRole("button", { name: "Cancel" }).click();
        await expect(drawer).toBeHidden();

        drawer = await openCreate(page);
        await expireSwitch(drawer).click();
        await expect(expiryDate(drawer)).toHaveValue(dateInput(30)); // the 30-day default, not 12 days
      });
    });
  }
}
