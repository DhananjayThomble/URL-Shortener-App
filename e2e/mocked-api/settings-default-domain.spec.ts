import { devices, expect, test, type Page } from "@playwright/test";
import {
  MOCK_USER,
  MOCK_WORKSPACE,
  mockApi,
  nestError,
  seedMockSession,
  type MockHandler,
  type MockReply,
} from "../support/mock-api";

/* E2E (#779): Settings > Default domain.

   Before: a free-text box. Typing a domain the workspace doesn't have and saving
   answered 200, silently kept the old default, showed no message, and left the
   Save / Discard bar up. Now: a select that offers only live domains; and if the
   API still refuses one (a domain removed in another tab, say) the 400's message
   is shown under that field and nothing is considered saved.

   This lane runs the REAL API client against browser-level answers, so the 400
   below is the body Nest sends for apps/api/src/workspaces/workspaces.service.ts
   resolveDefaultDomain (BadRequestException -> {statusCode, message, error}),
   pinned against the real service by workspaces.default-domain.integration.test.ts.

   Viewports: desktop plus the two phones used across the suite (iPhone 15 at
   393x852, Pixel 7). The CI lane installs chromium only, so both phones run on
   chromium with the device's viewport/touch/UA; WebKit is exercised in the
   real-stack verification instead. */

const SHARED = { id: "dom_shared", domain: "snap.to", status: "live", ssl: "active", links: 3, rootRedirect: null, notFoundRedirect: null, shared: true } as const;
const OWN = { id: "dom_own", domain: "go.acme.test", status: "live", ssl: "active", links: 1, rootRedirect: null, notFoundRedirect: null } as const;
const PENDING = { id: "dom_pending", domain: "later.acme.test", status: "verifying", ssl: "pending", links: 0, rootRedirect: null, notFoundRedirect: null } as const;
const FAILED = { id: "dom_failed", domain: "broken.acme.test", status: "failed", ssl: "failed", links: 0, rootRedirect: null, notFoundRedirect: null } as const;

type Role = "owner" | "admin" | "editor" | "viewer";

/** A stateful stand-in for GET/PATCH /workspaces/current that follows the API's rule. */
async function openSettings(page: Page, opts: { role?: Role; refuseWith?: MockReply } = {}) {
  const role = opts.role ?? "owner";
  const workspace: Record<string, unknown> = { ...MOCK_WORKSPACE };
  let domainGets = 0;

  const patch: MockHandler = (req) => {
    const body = req.body as Record<string, unknown>;
    if (role === "editor" || role === "viewer") return nestError(403, "Your role can't do that.", "Forbidden");
    if (opts.refuseWith) return opts.refuseWith;
    Object.assign(workspace, body);
    return { status: 200, body: workspace };
  };

  await seedMockSession(page);
  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: { ...MOCK_USER, role } },
    "GET /workspaces/current": () => ({ status: 200, body: workspace }),
    "PATCH /workspaces/current": patch,
    "GET /domains": () => {
      domainGets += 1;
      return { status: 200, body: [OWN, PENDING, FAILED, SHARED] };
    },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
  });
  await page.goto("/settings");
  return { api, workspace, domainGets: () => domainGets };
}

const select = (page: Page) => page.getByLabel("Default domain");
const saveBtn = (page: Page) => page.getByRole("button", { name: "Save changes" });

const VIEWPORTS = [
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  { name: "iPhone 15 (393px)", use: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15"].userAgent } },
  { name: "Pixel 7", use: { viewport: devices["Pixel 7"].viewport, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent } },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`Settings > Default domain (#779) — ${vp.name}`, () => {
    test.use(vp.use);

    test("is a select offering only live domains (never free text, never a pending or failed one)", async ({ page }) => {
      await openSettings(page);
      const el = select(page);
      await expect(el).toBeVisible();
      expect(await el.evaluate((n) => n.tagName)).toBe("SELECT");
      await expect(el).toHaveValue("snap.to");

      const options = await el.locator("option").evaluateAll((os) =>
        os.map((o) => ({ value: (o as HTMLOptionElement).value, disabled: (o as HTMLOptionElement).disabled })),
      );
      expect(options).toEqual([
        { value: "go.acme.test", disabled: false },
        { value: "snap.to", disabled: false },
      ]);
    });

    test("choosing a domain and saving sends it, then the Save bar goes away", async ({ page }) => {
      const { api } = await openSettings(page);
      await expect(saveBtn(page)).toBeDisabled();

      await select(page).selectOption("go.acme.test");
      await expect(saveBtn(page)).toBeEnabled();
      await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();

      await saveBtn(page).click();
      await expect(page.getByText("Saved.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Discard" })).toHaveCount(0);
      await expect(saveBtn(page)).toBeDisabled();
      await expect(select(page)).toHaveValue("go.acme.test");

      const sent = api.callsTo("PATCH", "/workspaces/current");
      expect(sent).toHaveLength(1);
      expect((sent[0]!.body as { defaultDomain: string }).defaultDomain).toBe("go.acme.test");

      // A reload shows what the server stored.
      await page.reload();
      await expect(select(page)).toHaveValue("go.acme.test");
      await expect(saveBtn(page)).toBeDisabled();
    });

    test("Discard puts the previous domain back without a request", async ({ page }) => {
      const { api } = await openSettings(page);
      await select(page).selectOption("go.acme.test");
      await page.getByRole("button", { name: "Discard" }).click();
      await expect(select(page)).toHaveValue("snap.to");
      await expect(saveBtn(page)).toBeDisabled();
      expect(api.callsTo("PATCH", "/workspaces/current")).toHaveLength(0);
    });

    test("a refusal from the API is shown under the field, in words, and the form stays unsaved", async ({ page }) => {
      const message = "go.acme.test isn't a domain in this workspace.";
      const { api, domainGets } = await openSettings(page, { refuseWith: nestError(400, message, "Bad Request") });
      const before = domainGets();

      await select(page).selectOption("go.acme.test");
      await saveBtn(page).click();

      const err = page.getByText(message);
      await expect(err).toBeVisible();
      // Belongs to the Default domain field, not to the redirect type or currency.
      await expect(select(page)).toHaveAttribute("aria-describedby", "settings-default-domain-hint");
      await expect(page.locator("#settings-default-domain-hint")).toHaveText(message);
      await expect(page.getByText("Saved.")).toHaveCount(0);
      // Nothing was saved, so the form is still dirty and the person can discard or retry.
      await expect(saveBtn(page)).toBeEnabled();
      await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();
      expect(api.callsTo("PATCH", "/workspaces/current")).toHaveLength(1);
      // The domain list is re-fetched, since it may be what went stale.
      await expect.poll(() => domainGets()).toBeGreaterThan(before);

      // Editing again clears the stale message.
      await select(page).selectOption("snap.to");
      await expect(page.getByText(message)).toHaveCount(0);
    });

    test("keyboard only: the select is focusable, changes with the arrow keys and saves with Enter on the button", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "arrow-key select behaviour is browser specific");
      await openSettings(page);
      await select(page).focus();
      await expect(select(page)).toBeFocused();
      await page.keyboard.press("ArrowUp"); // snap.to -> go.acme.test
      await expect(select(page)).toHaveValue("go.acme.test");
      await saveBtn(page).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Saved.")).toBeVisible();
    });
  });
}

test.describe("Settings > Default domain (#779) — roles", () => {
  for (const role of ["owner", "admin"] as const) {
    test(`${role} can change it`, async ({ page }) => {
      await openSettings(page, { role });
      await expect(select(page)).toBeEnabled();
      await expect(page.getByText("Only owners and admins can change the default domain.")).toHaveCount(0);
    });
  }

  for (const role of ["editor", "viewer"] as const) {
    test(`${role} sees it but cannot change it, and is told why`, async ({ page }) => {
      const { api } = await openSettings(page, { role });
      await expect(select(page)).toBeVisible();
      await expect(select(page)).toBeDisabled();
      await expect(select(page)).toHaveValue("snap.to");
      await expect(page.getByText("Only owners and admins can change the default domain.")).toBeVisible();
      expect(api.callsTo("PATCH", "/workspaces/current")).toHaveLength(0);
    });
  }
});

test("Settings > Default domain (#779) — a current default that is no longer live is still shown, but can't be re-picked", async ({ page }) => {
  await seedMockSession(page);
  await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /workspaces/current": { status: 200, body: { ...MOCK_WORKSPACE, defaultDomain: "broken.acme.test" } },
    "GET /domains": { status: 200, body: [OWN, FAILED, SHARED] },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
  });
  await page.goto("/settings");
  await expect(select(page)).toHaveValue("broken.acme.test");
  const broken = select(page).locator('option[value="broken.acme.test"]');
  await expect(broken).toBeDisabled();
  await expect(broken).toHaveText(/verification failed/);
  // Changing something else does not require touching it.
  await expect(saveBtn(page)).toBeDisabled();
});
