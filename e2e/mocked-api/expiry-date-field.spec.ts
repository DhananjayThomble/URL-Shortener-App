import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, fakeAccessToken, mockApi, seedMockSession, type MockApi } from "../support/mock-api";

/* E2E (#754): an expiry date that has already passed is refused INLINE on the
   "Expiry date" field of the New link / Edit link drawers, and nothing is sent.

   Before the fix, New link → Access → "Expire on a date" → a past day → Create
   posted the date and the API created a link that was expired from birth.

   Oracle: the shared rule `validateExpiry` (packages/domain) that the API also
   enforces — an expiry at or before "now" is already expired (deriveStatus).
   The field turns a picked DAY into the END of that day in the viewer's local
   time ("stops working after the date you pick"), so "today" is always fine and
   "yesterday" in the viewer's own calendar is the first day refused — whatever
   day it is in UTC. Edit: an expired link's UNCHANGED expiry must not block
   saving its other fields; only a changed expiry is judged.

   Mocked-API lane: what matters is the exact body the browser sends to POST
   /links and PATCH /links/:id, and that nothing is sent for a refused date. The
   real-API round trip is journey j754-past-expiry.spec.ts. */

const SLUG = "dated";
const CREATED = "2026-01-01T00:00:00.000Z";
const DAY = 86_400_000;
const PAST_MESSAGE = /already passed/;

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
const dayIn = (timeZone: string, at: number) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(at));

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
    safeBrowsing: { status: "clean", checkedAt: CREATED },
    sparkline: Array.from({ length: 30 }, () => 0),
    createdAt: CREATED,
    expiresAt: null as string | null,
    ...over,
  };
}

async function installApi(
  page: Page,
  initial: ReturnType<typeof link>[] = [],
  overrides: Parameters<typeof mockApi>[1] = {},
): Promise<MockApi> {
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
    ...overrides,
  });
}

const expiryInput = (drawer: Locator) => drawer.getByLabel("Expiry date", { exact: true });
const expiryToggle = (drawer: Locator) => drawer.getByRole("button", { name: /Expire on a date/ });
const saveEdit = (drawer: Locator) => drawer.getByRole("button", { name: "Save changes" });
const saveCreate = (drawer: Locator) => drawer.getByRole("button", { name: "Create link" });

async function openCreate(page: Page): Promise<Locator> {
  await page.goto("/links");
  await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "Create a link" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Destination URL").fill("https://example.com/landing");
  await drawer.getByLabel("Short link").fill("new-dated");
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

/* The text of the inline error under the date field: the element the input's
   aria-describedby points at (null when the field has no error). */
async function errorText(drawer: Locator): Promise<string | null> {
  const id = await expiryInput(drawer).getAttribute("aria-describedby");
  if (!id) return null;
  return drawer.locator(`[id="${id}"]`).textContent();
}

/** The ISO instant the drawer stores for a picked day: the end of that day in the page's local time. */
const endOfLocalDay = (page: Page, day: string) => page.evaluate((d) => new Date(`${d}T23:59:59.999`).toISOString(), day);

const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];
const viewports = [
  { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  { name: "mobile (Pixel 7, 412px)", use: pixel7 },
] as const;

const TZ = "Asia/Kolkata";

for (const vp of viewports) {
  test.describe(`Expiry date field — create — ${vp.name}`, () => {
    test.use({ ...vp.use, timezoneId: TZ });

    test("yesterday is refused inline, nothing is posted, and the Access tab shows why; today then creates", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await expiryToggle(drawer).click();

      const yesterday = dayIn(TZ, Date.now() - DAY);
      await expiryInput(drawer).fill(yesterday);
      await expect(expiryInput(drawer)).toHaveValue(yesterday); // kept as picked, not "fixed"
      await expect(expiryInput(drawer)).toHaveAttribute("aria-invalid", "true");
      expect(await errorText(drawer)).toMatch(PAST_MESSAGE);

      // Submit from another tab: the drawer lands on the tab holding the error.
      await drawer.getByRole("tab", { name: "Destination", exact: true }).click();
      await saveCreate(drawer).click();
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("tab", { name: "Access (has an error)" })).toHaveAttribute("aria-selected", "true");
      expect(await errorText(drawer)).toMatch(PAST_MESSAGE);
      expect(api.callsTo("POST", "/links")).toHaveLength(0);

      const today = dayIn(TZ, Date.now());
      await expiryInput(drawer).fill(today);
      await expect(expiryInput(drawer)).not.toHaveAttribute("aria-invalid", "true");
      expect(await errorText(drawer)).toBeNull();
      await saveCreate(drawer).click();
      await expect(drawer).toBeHidden();
      const posts = api.callsTo("POST", "/links");
      expect(posts).toHaveLength(1);
      expect((posts[0].body as { expiresAt: string }).expiresAt).toBe(await endOfLocalDay(page, today));
    });

    test("the issue's own date (2026-01-01) is refused and the Enter key does not get round it", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await expiryToggle(drawer).click();
      await expiryInput(drawer).fill("2026-01-01");
      expect(await errorText(drawer)).toMatch(PAST_MESSAGE);
      await expiryInput(drawer).press("Enter");
      await saveCreate(drawer).dblclick();
      await expect(drawer).toBeVisible();
      expect(api.callsTo("POST", "/links")).toHaveLength(0);
    });

    test("switching the expiry off clears the error and creates a link with no expiry", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await expiryToggle(drawer).click();
      await expiryInput(drawer).fill("2026-01-01");
      expect(await errorText(drawer)).toMatch(PAST_MESSAGE);
      await expiryToggle(drawer).click();
      expect(await errorText(drawer)).toBeNull();
      await saveCreate(drawer).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("POST", "/links")[0].body as { expiresAt?: string | null }).expiresAt ?? null).toBeNull();
    });

    test("the switch's own default (30 days out) is accepted as is", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await expiryToggle(drawer).click();
      expect(await errorText(drawer)).toBeNull();
      await saveCreate(drawer).click();
      await expect(drawer).toBeHidden();
      const sent = (api.callsTo("POST", "/links")[0].body as { expiresAt: string }).expiresAt;
      expect(Date.parse(sent)).toBeGreaterThan(Date.now() + 29 * DAY);
    });

    test("if the API still refuses (its clock is the authority), its message is shown and the drawer stays open", async ({ page }) => {
      const message = "That expiry date has already passed, so the link would stop working straight away. Choose a later date, or remove the expiry.";
      const api = await installApi(page, [], {
        "POST /links": { status: 400, body: { statusCode: 400, error: "Bad Request", message: [message] } },
      });
      const drawer = await openCreate(page);
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await expiryToggle(drawer).click();
      await expiryInput(drawer).fill(dayIn(TZ, Date.now()));
      await saveCreate(drawer).click();
      await expect(drawer.getByText(message)).toBeVisible();
      await expect(drawer).toBeVisible();
      expect(api.callsTo("POST", "/links")).toHaveLength(1);
    });
  });

  test.describe(`Expiry date field — edit — ${vp.name}`, () => {
    test.use({ ...vp.use, timezoneId: TZ });

    const expired = () => link({ status: "expired", expiresAt: new Date(Date.now() - 10 * DAY).toISOString() });

    test("an EXPIRED link opens with no error and its other fields still save; its expiry is sent back unchanged", async ({ page }) => {
      const start = expired();
      const api = await installApi(page, [start]);
      const drawer = await openEdit(page);
      await expect(expiryInput(drawer)).toHaveValue(dayIn(TZ, Date.parse(start.expiresAt!)));
      expect(await errorText(drawer)).toBeNull();

      await drawer.getByRole("tab", { name: "Destination", exact: true }).click();
      await drawer.getByLabel("Destination URL").fill("https://example.com/moved");
      await saveEdit(drawer).click();
      await expect(drawer).toBeHidden();
      const body = api.callsTo("PATCH", "/links/lnk_1")[0].body as { destination: string; expiresAt: string };
      expect(body.destination).toBe("https://example.com/moved");
      expect(body.expiresAt).toBe(start.expiresAt);
    });

    test("an expired link cannot be moved to a different past day; a future day then saves", async ({ page }) => {
      const api = await installApi(page, [expired()]);
      const drawer = await openEdit(page);
      await expiryInput(drawer).fill(dayIn(TZ, Date.now() - 3 * DAY));
      expect(await errorText(drawer)).toMatch(PAST_MESSAGE);
      await saveEdit(drawer).click();
      await expect(drawer).toBeVisible();
      expect(await errorText(drawer)).toMatch(PAST_MESSAGE);
      expect(api.callsTo("PATCH", "/links/lnk_1")).toHaveLength(0);

      const future = dayIn(TZ, Date.now() + 14 * DAY);
      await expiryInput(drawer).fill(future);
      expect(await errorText(drawer)).toBeNull();
      await saveEdit(drawer).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("PATCH", "/links/lnk_1")[0].body as { expiresAt: string }).expiresAt).toBe(await endOfLocalDay(page, future));
    });

    test("a live link's expiry cannot be set to yesterday", async ({ page }) => {
      const api = await installApi(page, [link({ expiresAt: new Date(Date.now() + 20 * DAY).toISOString() })]);
      const drawer = await openEdit(page);
      await expiryInput(drawer).fill(dayIn(TZ, Date.now() - DAY));
      await saveEdit(drawer).click();
      await expect(drawer).toBeVisible();
      await expect(expiryInput(drawer)).toHaveAttribute("aria-invalid", "true");
      expect(await errorText(drawer)).toMatch(PAST_MESSAGE);
      expect(api.callsTo("PATCH", "/links/lnk_1")).toHaveLength(0);
    });

    test("the error survives a tab switch, and a re-open starts clean from the saved expiry", async ({ page }) => {
      await installApi(page, [expired()]);
      const drawer = await openEdit(page);
      await expiryInput(drawer).fill("2026-01-01");
      await drawer.getByRole("tab", { name: "Routing", exact: true }).click();
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await expect(expiryInput(drawer)).toHaveValue("2026-01-01");
      expect(await errorText(drawer)).toMatch(PAST_MESSAGE);

      await drawer.getByRole("button", { name: "Close" }).click();
      await expect(drawer).toBeHidden();
      const again = await openEdit(page);
      expect(await errorText(again)).toBeNull();
    });

    test("switching an expired link's expiry off saves null", async ({ page }) => {
      const api = await installApi(page, [expired()]);
      const drawer = await openEdit(page);
      await expiryToggle(drawer).click();
      await saveEdit(drawer).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("PATCH", "/links/lnk_1")[0].body as { expiresAt: string | null }).expiresAt).toBeNull();
    });
  });
}

/* Time-zone boundaries: the viewer's own calendar decides what "today" is. */
for (const [timezoneId, label] of [
  ["Pacific/Pago_Pago", "UTC-11 (often still yesterday in UTC terms)"],
  ["Pacific/Kiritimati", "UTC+14 (often already tomorrow in UTC terms)"],
] as const) {
  test.describe(`Expiry date field — ${label}`, () => {
    test.use({ timezoneId, viewport: { width: 1280, height: 800 } });

    test("today in the viewer's zone is accepted and posted as the end of that local day; yesterday is refused", async ({ page }) => {
      const api = await installApi(page);
      const drawer = await openCreate(page);
      await drawer.getByRole("tab", { name: "Access", exact: true }).click();
      await expiryToggle(drawer).click();

      await expiryInput(drawer).fill(dayIn(timezoneId, Date.now() - DAY));
      expect(await errorText(drawer)).toMatch(PAST_MESSAGE);

      const today = dayIn(timezoneId, Date.now());
      await expiryInput(drawer).fill(today);
      expect(await errorText(drawer)).toBeNull();
      await saveCreate(drawer).click();
      await expect(drawer).toBeHidden();
      const sent = (api.callsTo("POST", "/links")[0].body as { expiresAt: string }).expiresAt;
      expect(sent).toBe(await endOfLocalDay(page, today));
      expect(Date.parse(sent)).toBeGreaterThan(Date.now());
    });
  });
}
