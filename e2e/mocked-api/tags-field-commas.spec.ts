import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, fakeAccessToken, mockApi, seedMockSession, type MockApi } from "../support/mock-api";

/* E2E (#752): the Tags field of the New link / Edit link drawers keeps a typed
   comma and space, and saves "a, b" as TWO tags.

   The field used to be controlled from the parsed array, so a typed "," was
   parsed to ["a", ""], the empty entry was filtered out, and the input snapped
   back to "a": the comma could never be typed and "a, b" was saved as "ab". The
   bug only exists KEYSTROKE BY KEYSTROKE — `fill()` sets the whole value in one
   input event and always worked — so every assertion here types with
   pressSequentially.

   Mocked-API lane: the assertion that matters is the exact `tags` array the
   browser sends in POST /links and PATCH /links/:id (the contract's
   CreateLinkInput / UpdateLinkInput), plus what the drawer shows after saving.
   Oracle for the saved shape: packages/contract/src/link.ts (`tags: string[]`).
   The real-API round trip is journey j752-link-tags-typed.spec.ts. */

const SLUG = "tagged";
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
      const input = req.body as { slug?: string; tags?: string[]; destination: string };
      const created = link({ id: `lnk_${store.length + 1}`, ...input, slug: input.slug || "auto" });
      store.unshift(created);
      return { status: 201, body: created };
    },
    "PATCH /links/lnk_1": (req) => {
      store[0] = { ...store[0], ...(req.body as object) };
      return { status: 200, body: store[0] };
    },
  });
}

/** The Tags input, found by its label as a user would. */
const tagsInput = (drawer: Locator) => drawer.getByLabel("Tags", { exact: true });

async function openCreate(page: Page): Promise<Locator> {
  await page.goto("/links");
  await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "Create a link" });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function openEdit(page: Page): Promise<Locator> {
  await page.goto("/links/lnk_1");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: new RegExp(`Edit .+/${SLUG}`) });
  await expect(drawer).toBeVisible();
  return drawer;
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
  test.describe(`Tags field — ${vp.name}`, () => {
    test.use(vp.use);

    test("create: typing 'a, b' key by key keeps the comma and sends two tags", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByLabel("Destination URL").fill("https://example.com/landing");
      await drawer.getByLabel("Short link").fill("two-tags");

      const tags = tagsInput(drawer);
      await tags.click();
      await tags.pressSequentially("a,");
      await expect(tags).toHaveValue("a,"); // the comma stays on screen
      await tags.pressSequentially(" ");
      await expect(tags).toHaveValue("a, "); // so does the space after it
      await tags.pressSequentially("b");
      await expect(tags).toHaveValue("a, b");

      await drawer.getByRole("button", { name: "Create link" }).click();
      await expect(drawer).toBeHidden();

      const posts = api.callsTo("POST", "/links");
      expect(posts).toHaveLength(1);
      expect((posts[0].body as { tags: string[] }).tags).toEqual(["a", "b"]);
    });

    test("create: a tag containing a space can be typed", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByLabel("Destination URL").fill("https://example.com/landing");
      await drawer.getByLabel("Short link").fill("spaced");

      const tags = tagsInput(drawer);
      await tags.click();
      await tags.pressSequentially("spring sale, campaign/q3");
      await expect(tags).toHaveValue("spring sale, campaign/q3");

      await drawer.getByRole("button", { name: "Create link" }).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("POST", "/links")[0].body as { tags: string[] }).tags).toEqual(["spring sale", "campaign/q3"]);
    });

    test("create: stray separators and blanks are cleaned up in what is saved (repeats are kept)", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByLabel("Destination URL").fill("https://example.com/landing");
      await drawer.getByLabel("Short link").fill("messy");

      const tags = tagsInput(drawer);
      await tags.click();
      await tags.pressSequentially(" , a,, b ,a, 🚀 launch,  ,");
      // Leaving the field tidies what was typed into the list that will be saved.
      await drawer.getByLabel("Destination URL").click();
      await expect(tags).toHaveValue("a, b, a, 🚀 launch");
      await drawer.getByRole("button", { name: "Create link" }).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("POST", "/links")[0].body as { tags: string[] }).tags).toEqual(["a", "b", "a", "🚀 launch"]);
    });

    test("create: leaving the field empty sends no tags", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByLabel("Destination URL").fill("https://example.com/landing");
      await drawer.getByLabel("Short link").fill("untagged");
      await tagsInput(drawer).pressSequentially(" , ");
      await drawer.getByRole("button", { name: "Create link" }).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("POST", "/links")[0].body as { tags: string[] }).tags).toEqual([]);
    });

    test("edit: existing tags are shown, typing extends them, and the PATCH carries the new list", async ({ page }) => {
      const api = await installApi(page, [link({ tags: ["alpha", "beta"] })]);
      const drawer = await openEdit(page);

      const tags = tagsInput(drawer);
      await expect(tags).toHaveValue("alpha, beta");
      await tags.click();
      await tags.press("End");
      await tags.pressSequentially(", gamma delta,");
      await expect(tags).toHaveValue("alpha, beta, gamma delta,");

      await drawer.getByRole("button", { name: "Save changes" }).click();
      await expect(drawer).toBeHidden();

      const patches = api.callsTo("PATCH", "/links/lnk_1");
      expect(patches).toHaveLength(1);
      expect((patches[0].body as { tags: string[] }).tags).toEqual(["alpha", "beta", "gamma delta"]);

      // Re-opening shows the saved tags, normalised.
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(tagsInput(page.getByRole("dialog", { name: new RegExp(`Edit .+/${SLUG}`) }))).toHaveValue(
        "alpha, beta, gamma delta",
      );
    });

    test("edit: clearing the field removes every tag", async ({ page }) => {
      const api = await installApi(page, [link({ tags: ["alpha", "beta"] })]);
      const drawer = await openEdit(page);
      await tagsInput(drawer).fill("");
      await drawer.getByRole("button", { name: "Save changes" }).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("PATCH", "/links/lnk_1")[0].body as { tags: string[] }).tags).toEqual([]);
    });

    test("typed text survives a switch of tab and back, and a re-open starts from the saved tags", async ({ page }) => {
      await installApi(page, [link({ tags: ["alpha"] })]);
      const drawer = await openEdit(page);
      const tags = tagsInput(drawer);
      await tags.click();
      await tags.press("End");
      await tags.pressSequentially(", beta");

      await drawer.getByRole("tab", { name: "Routing", exact: true }).click();
      await drawer.getByRole("tab", { name: "Destination", exact: true }).click();
      await expect(tagsInput(drawer)).toHaveValue("alpha, beta");

      // Close without saving, re-open: the unsaved edit is gone, the saved tags are back.
      await drawer.getByRole("button", { name: "Close" }).click();
      await expect(drawer).toBeHidden();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(tagsInput(page.getByRole("dialog", { name: new RegExp(`Edit .+/${SLUG}`) }))).toHaveValue("alpha");
    });
  });
}
