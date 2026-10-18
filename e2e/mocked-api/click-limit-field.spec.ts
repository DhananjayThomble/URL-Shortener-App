import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, fakeAccessToken, mockApi, seedMockSession, type MockApi } from "../support/mock-api";

/* E2E (#758): the "Click limit" field of the New link / Edit link drawers keeps what
   the user types and validates it with a visible message, instead of clamping on
   every keystroke.

   The field used to run `value === "" ? 1 : Math.max(1, floor(Number(value)))` on
   every change, so clearing it snapped to "1" (typing "-5" gave "15") and 0 / a
   negative number was silently saved as 1. The bug only exists KEYSTROKE BY
   KEYSTROKE — `fill()` sets the whole value in one input event — so every
   assertion that matters here types with pressSequentially.

   Mocked-API lane: the assertion that matters is the exact `clickLimit` the browser
   sends in POST /links / PATCH /links/:id (the contract's CreateLinkInput /
   UpdateLinkInput), and that NOTHING is sent for a value that is not a limit.
   Oracle for what a limit is: packages/contract/src/link.ts (ClickLimitInput: whole
   number 1..2,147,483,647; null = no limit). The real-API round trip is journey
   j758-click-limit-typed.spec.ts. */

const SLUG = "limited";
const NOW = "2026-01-01T00:00:00.000Z";
const MAX = "2147483647";

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
    ...over,
  };
}

/** A stateful stand-in for the links endpoints the New link / Edit link drawers use. */
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

const limitInput = (drawer: Locator) => drawer.getByLabel("Click limit", { exact: true });
const limitToggle = (drawer: Locator) => drawer.getByRole("button", { name: /Expire after a click limit/ });
const saveEdit = (drawer: Locator) => drawer.getByRole("button", { name: "Save changes" });
const saveCreate = (drawer: Locator) => drawer.getByRole("button", { name: "Create link" });

async function openCreate(page: Page): Promise<Locator> {
  await page.goto("/links");
  await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "Create a link" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Destination URL").fill("https://example.com/landing");
  await drawer.getByLabel("Short link").fill("new-limited");
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

/** Replace the whole content of the field by typing, one key at a time, as a user does. */
async function retype(input: Locator, text: string) {
  await input.click();
  await input.press("ControlOrMeta+a");
  if (text === "") await input.press("Backspace");
  else await input.pressSequentially(text);
}

/** Leave the field (blur) by clicking somewhere inert in the drawer. */
async function leave(drawer: Locator) {
  await drawer.getByRole("heading", { level: 2 }).click();
}

/* The text of the inline error under the field: the element the input's
   aria-describedby points at (null when the field has no error). */
async function errorText(drawer: Locator): Promise<string | null> {
  const input = limitInput(drawer);
  const id = await input.getAttribute("aria-describedby");
  if (!id) return null;
  return drawer.locator(`[id="${id}"]`).textContent();
}

/* `defaultBrowserType` is part of a device descriptor and cannot be set inside a
   describe (it forces a new worker); the lane is chromium, which is also Pixel 7's
   engine, so take everything else from the descriptor. */
const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];
const viewports = [
  { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  { name: "mobile (Pixel 7, 412px)", use: pixel7 },
] as const;

for (const vp of viewports) {
  test.describe(`Click limit field — edit — ${vp.name}`, () => {
    test.use(vp.use);

    test("shows the saved limit; typing '0' key by key stays '0' (not 1) and blocks the save with a message", async ({ page }) => {
      const api = await installApi(page, [link({ clickLimit: 500 })]);
      const drawer = await openEdit(page);
      const input = limitInput(drawer);
      await expect(input).toHaveValue("500");

      await retype(input, "0");
      await expect(input).toHaveValue("0"); // was: snapped to "1"
      await leave(drawer);
      await expect(input).toHaveValue("0");
      await expect(input).toHaveAttribute("aria-invalid", "true");
      expect(await errorText(drawer)).toContain("at least 1");

      await saveEdit(drawer).click();
      await expect(drawer).toBeVisible(); // not saved
      expect(api.callsTo("PATCH", "/links/lnk_1")).toHaveLength(0);
    });

    test("typing '-5' key by key stays '-5' (not '15'), is rejected, and '5' then saves as 5", async ({ page }) => {
      const api = await installApi(page, [link({ clickLimit: 500 })]);
      const drawer = await openEdit(page);
      const input = limitInput(drawer);

      await retype(input, "-5");
      await expect(input).toHaveValue("-5");
      await leave(drawer);
      expect(await errorText(drawer)).toContain("at least 1");
      await saveEdit(drawer).click();
      expect(api.callsTo("PATCH", "/links/lnk_1")).toHaveLength(0);

      await retype(input, "5");
      await expect(input).toHaveValue("5");
      await expect(input).not.toHaveAttribute("aria-invalid", "true");
      expect(await errorText(drawer)).toBeNull();
      await saveEdit(drawer).click();
      await expect(drawer).toBeHidden();
      const patches = api.callsTo("PATCH", "/links/lnk_1");
      expect(patches).toHaveLength(1);
      expect((patches[0].body as { clickLimit: number }).clickLimit).toBe(5);
    });

    test("the field can be emptied and retyped: '500' -> '' -> '25' saves 25 (not 125)", async ({ page }) => {
      const api = await installApi(page, [link({ clickLimit: 500 })]);
      const drawer = await openEdit(page);
      const input = limitInput(drawer);

      await input.click();
      await input.press("ControlOrMeta+a");
      await input.press("Backspace");
      await expect(input).toHaveValue(""); // was: snapped back to "1"
      await expect(limitToggle(drawer)).toHaveAttribute("aria-pressed", "true"); // emptying it does not switch the limit off
      await expect(input).toBeEnabled();

      await input.pressSequentially("25");
      await expect(input).toHaveValue("25"); // was: "125"
      await saveEdit(drawer).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("PATCH", "/links/lnk_1")[0].body as { clickLimit: number }).clickLimit).toBe(25);
    });

    test("an empty field with the limit switched on blocks the save and says how to remove the limit", async ({ page }) => {
      const api = await installApi(page, [link({ clickLimit: 500 })]);
      const drawer = await openEdit(page);
      const input = limitInput(drawer);
      await retype(input, "");
      await leave(drawer);
      expect(await errorText(drawer)).toMatch(/Enter a click limit.*turn the limit off/);
      await saveEdit(drawer).click();
      await expect(drawer).toBeVisible();
      expect(api.callsTo("PATCH", "/links/lnk_1")).toHaveLength(0);
    });

    test("the error appears when leaving the field, not while typing", async ({ page }) => {
      await installApi(page, [link({ clickLimit: 500 })]);
      const drawer = await openEdit(page);
      const input = limitInput(drawer);
      await input.click();
      await input.press("ControlOrMeta+a");
      await input.pressSequentially("-");
      await expect(input).toHaveValue("-");
      expect(await errorText(drawer)).toBeNull(); // still typing "-5"
      await input.pressSequentially("5");
      expect(await errorText(drawer)).toBeNull();
      await leave(drawer);
      expect(await errorText(drawer)).not.toBeNull();
    });

    for (const [text, wording] of [
      ["2.5", "whole number"],
      ["2.0", "whole number"],
      ["1e3", "whole number"],
      ["abc", "whole number"],
      ["1,000", "whole number"],
      ["+5", "whole number"],
      ["2147483648", "more than"],
      ["99999999999999999999", "more than"],
      ["-0", "at least 1"],
      ["00", "at least 1"],
    ] as const) {
      test(`rejects ${JSON.stringify(text)} with a message and sends nothing`, async ({ page }) => {
        const api = await installApi(page, [link({ clickLimit: 500 })]);
        const drawer = await openEdit(page);
        const input = limitInput(drawer);
        await retype(input, text);
        await expect(input).toHaveValue(text); // kept exactly as typed
        await saveEdit(drawer).click(); // submit without ever leaving the field by hand
        await expect(drawer).toBeVisible();
        expect(await errorText(drawer)).toContain(wording);
        expect(api.callsTo("PATCH", "/links/lnk_1")).toHaveLength(0);
      });
    }

    test("leading zeros and surrounding spaces are read sensibly: ' 007 ' saves 7 and is shown as 7", async ({ page }) => {
      const api = await installApi(page, [link({ clickLimit: 500 })]);
      const drawer = await openEdit(page);
      const input = limitInput(drawer);
      await retype(input, " 007 ");
      await expect(input).toHaveValue(" 007 "); // untouched while typing
      await leave(drawer);
      await expect(input).toHaveValue("7"); // tidied once the user leaves
      await saveEdit(drawer).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("PATCH", "/links/lnk_1")[0].body as { clickLimit: number }).clickLimit).toBe(7);
    });

    test("1 and the maximum 2147483647 are valid and sent exactly as typed", async ({ page }) => {
      const api = await installApi(page, [link({ clickLimit: 500 })]);
      let drawer = await openEdit(page);
      await retype(limitInput(drawer), MAX);
      await saveEdit(drawer).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("PATCH", "/links/lnk_1")[0].body as { clickLimit: number }).clickLimit).toBe(2147483647);

      drawer = await openEdit(page);
      await expect(limitInput(drawer)).toHaveValue(MAX);
      await retype(limitInput(drawer), "1");
      await saveEdit(drawer).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("PATCH", "/links/lnk_1")[1].body as { clickLimit: number }).clickLimit).toBe(1);
    });

    test("an invalid entry survives a switch of tab and back, and a re-open starts from the saved limit", async ({ page }) => {
      await installApi(page, [link({ clickLimit: 500 })]);
      const drawer = await openEdit(page);
      await retype(limitInput(drawer), "-5");

      await drawer.getByRole("tab", { name: "Routing", exact: true }).click();
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await expect(limitInput(drawer)).toHaveValue("-5");

      await drawer.getByRole("button", { name: "Close" }).click();
      await expect(drawer).toBeHidden();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const again = page.getByRole("dialog", { name: new RegExp(`Edit .+/${SLUG}`) });
      await again.getByRole("tab", { name: "Access", exact: true }).click();
      await expect(limitInput(again)).toHaveValue("500");
    });

    test("switching the limit off sends null even from an invalid entry, and switching it back on starts at 500", async ({ page }) => {
      const api = await installApi(page, [link({ clickLimit: 500 })]);
      const drawer = await openEdit(page);
      await retype(limitInput(drawer), "abc");
      await limitToggle(drawer).click();
      await expect(limitInput(drawer)).toBeDisabled();
      await expect(limitInput(drawer)).toHaveValue("");
      await saveEdit(drawer).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("PATCH", "/links/lnk_1")[0].body as { clickLimit: number | null }).clickLimit).toBeNull();

      const again = await openEdit(page);
      await expect(limitInput(again)).toBeDisabled();
      await limitToggle(again).click();
      await expect(limitInput(again)).toHaveValue("500");
    });

    test("a link saved with a limit of 0 (before the API checked) shows 0 and asks for a real limit", async ({ page }) => {
      const api = await installApi(page, [link({ clickLimit: 0 })]);
      const drawer = await openEdit(page);
      await expect(limitInput(drawer)).toHaveValue("0");
      await saveEdit(drawer).click();
      await expect(drawer).toBeVisible();
      expect(await errorText(drawer)).toContain("at least 1");
      expect(api.callsTo("PATCH", "/links/lnk_1")).toHaveLength(0);
      await retype(limitInput(drawer), "10");
      await saveEdit(drawer).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("PATCH", "/links/lnk_1")[0].body as { clickLimit: number }).clickLimit).toBe(10);
    });

    test("a link with no limit is untouched: the field is disabled and a save sends null", async ({ page }) => {
      const api = await installApi(page, [link({ clickLimit: null })]);
      const drawer = await openEdit(page);
      await expect(limitInput(drawer)).toBeDisabled();
      await expect(limitInput(drawer)).toHaveValue("");
      await saveEdit(drawer).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("PATCH", "/links/lnk_1")[0].body as { clickLimit: number | null }).clickLimit).toBeNull();
    });
  });

  test.describe(`Click limit field — create — ${vp.name}`, () => {
    test.use(vp.use);

    test("switch on (500), type '0' key by key: stays '0', create is blocked and the Access tab shows why", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await limitToggle(drawer).click();
      await expect(limitInput(drawer)).toHaveValue("500");

      await retype(limitInput(drawer), "0");
      await expect(limitInput(drawer)).toHaveValue("0");

      // Submit from another tab: the drawer lands on the tab holding the error.
      await drawer.getByRole("tab", { name: "Destination", exact: true }).click();
      await saveCreate(drawer).click();
      await expect(drawer).toBeVisible();
      // The tab that holds the error is flagged "(has an error)" for screen readers.
      await expect(drawer.getByRole("tab", { name: /^Access/ })).toHaveAttribute("aria-selected", "true");
      await expect(drawer.getByRole("tab", { name: "Access (has an error)" })).toBeVisible();
      await expect(limitInput(drawer)).toHaveValue("0");
      expect(await errorText(drawer)).toContain("at least 1");
      expect(api.callsTo("POST", "/links")).toHaveLength(0);
    });

    test("'-5' is rejected; fixing it to '3' creates the link with clickLimit 3", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await limitToggle(drawer).click();
      await retype(limitInput(drawer), "-5");
      await expect(limitInput(drawer)).toHaveValue("-5");
      await saveCreate(drawer).click();
      await expect(drawer).toBeVisible();
      expect(await errorText(drawer)).toContain("at least 1");
      expect(api.callsTo("POST", "/links")).toHaveLength(0);

      await retype(limitInput(drawer), "3");
      await expect(limitInput(drawer)).toHaveValue("3");
      await saveCreate(drawer).click();
      await expect(drawer).toBeHidden();
      const posts = api.callsTo("POST", "/links");
      expect(posts).toHaveLength(1);
      expect((posts[0].body as { clickLimit: number }).clickLimit).toBe(3);
    });

    test("an emptied field blocks create; retyping '25' creates with 25 (not 125)", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await limitToggle(drawer).click();
      await retype(limitInput(drawer), "");
      await expect(limitInput(drawer)).toHaveValue("");
      await saveCreate(drawer).click();
      await expect(drawer).toBeVisible();
      expect(await errorText(drawer)).toMatch(/Enter a click limit/);
      expect(api.callsTo("POST", "/links")).toHaveLength(0);

      await limitInput(drawer).pressSequentially("25");
      await expect(limitInput(drawer)).toHaveValue("25");
      await saveCreate(drawer).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("POST", "/links")[0].body as { clickLimit: number }).clickLimit).toBe(25);
    });

    test("decimal, exponent and over-maximum entries are rejected on create", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await limitToggle(drawer).click();
      for (const [text, wording] of [
        ["2.5", "whole number"],
        ["1e3", "whole number"],
        ["2147483648", "more than"],
      ] as const) {
        await retype(limitInput(drawer), text);
        await saveCreate(drawer).click();
        await expect(drawer).toBeVisible();
        expect(await errorText(drawer)).toContain(wording);
      }
      expect(api.callsTo("POST", "/links")).toHaveLength(0);
    });

    test("no limit at all is still the default: the link is created without a clickLimit", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await saveCreate(drawer).click();
      await expect(drawer).toBeHidden();
      const body = api.callsTo("POST", "/links")[0].body as { clickLimit?: number | null };
      expect(body.clickLimit ?? null).toBeNull();
    });
  });
}
