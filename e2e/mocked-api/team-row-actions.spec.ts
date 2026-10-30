import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession } from "../support/mock-api";
import {
  clickInPlace,
  expectHeaderAlignsWithCells,
  expectNoPageOverflow,
  expectReachable,
  scrollTableEnd,
  scrollTableStart,
} from "../support/row-actions";

/* E2E (#859): the Team members table's row actions (Change role, the inline role
   editor, Remove) must be visible and operable without horizontal scrolling, in
   both themes, at 1316 / 1024 / 640 / 390.

   The row's last cell is the pinned <ActionsTd/> column (#786). The inline role
   editor (#781/#825) is wide: opened inside that pinned cell it makes the table
   overflow its scroller and pushes role options and Done out of reach (it also
   did on main at 1024). So the editor opens inline in the pinned cell only when
   the table still fits; otherwise the role control moves to the Member cell and
   only Done stays pinned.

   Same real-pixel clicks as the #786 / #832 specs (support/row-actions.ts: no
   scrollIntoView, which would mask a clipped control). Chromium only. */

type Role = "owner" | "admin" | "editor" | "viewer";
const member = (id: string, name: string, role: Role) => ({
  id,
  name,
  email: `${name.split(" ")[0]!.toLowerCase()}@mock.test`,
  role,
  status: "active",
  links: 4,
  lastActive: "2026-10-17T08:00:00.000Z",
  invitedAt: null,
  twoFactor: true,
  initials: name.split(" ").map((p) => p[0]).join(""),
});

const WIDTHS = [
  { name: "1316px", width: 1316, use: { viewport: { width: 1316, height: 900 } } },
  { name: "1024px", width: 1024, use: { viewport: { width: 1024, height: 900 } } },
  { name: "640px", width: 640, use: { viewport: { width: 640, height: 900 }, hasTouch: true } },
  {
    name: "390px",
    width: 390,
    use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent },
  },
] as const;

const ROLE_LABELS = ["Viewer", "Editor", "Admin", "Owner"] as const;

async function openTeam(page: Page, theme: "light" | "dark") {
  await seedMockSession(page);
  await page.addInitScript((mode) => {
    localStorage.setItem("snapurl.appearance", JSON.stringify({ mode }));
  }, theme);
  const store = [member("mem_owner", "Mock Owner", "owner"), member("mem_arjun", "Arjun Kapoor", "editor"), member("mem_priya", "Priya Nair", "viewer")];
  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: { ...MOCK_USER } },
    "GET /auth/workspaces": { status: 200, body: [] },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /members": () => ({ status: 200, body: store }),
    "PATCH /members/mem_arjun": (req) => {
      store[1]!.role = (req.body as { role: Role }).role;
      return { status: 204 };
    },
    "DELETE /members/mem_arjun": () => {
      store.splice(1, 1);
      return { status: 204 };
    },
    "GET /audit": { status: 200, body: [] },
    "GET /domains": { status: 200, body: [] },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
  });
  await page.goto("/team");
  const row = page.getByRole("row", { name: /Arjun Kapoor/ });
  await expect(row).toBeVisible();
  return { api, row };
}

const roleGroup = (row: Locator) => row.getByRole("group", { name: /Role for/ });
const insidePinned = (row: Locator) => row.locator("[data-actions-col]").getByRole("group", { name: /Role for/ });

/* The pinned column settles via a ResizeObserver after first paint (see #832 spec). */
async function expectHeaderAligned(header: Locator, cell: Locator, what: string) {
  await expect(async () => {
    await expectHeaderAlignsWithCells(header, cell, what);
  }).toPass({ timeout: 5000 });
}

for (const theme of ["light", "dark"] as const) {
  for (const w of WIDTHS) {
    test.describe(`Team row actions reachable without scrolling (#859) - ${theme}, ${w.name}`, () => {
      test.use(w.use);

      test("Change role and Remove are fully visible and clickable in place", async ({ page }) => {
        const { row } = await openTeam(page, theme);
        await expectNoPageOverflow(page);
        const change = row.getByRole("button", { name: "Change role" });
        const remove = row.getByRole("button", { name: "Remove" });
        await expectReachable(change, "Change role");
        await expectReachable(remove, "Remove");
        await scrollTableEnd(remove);
        await expectReachable(change, "Change role after scrolling right");
        await expectReachable(remove, "Remove after scrolling right");
        await scrollTableStart(remove);
        await expectReachable(change, "Change role after scrolling back");
        await expectReachable(remove, "Remove after scrolling back");
      });

      test("the role editor, every role option and Done are reachable, a role is saved, Done closes", async ({ page }) => {
        const { api, row } = await openTeam(page, theme);
        await clickInPlace(page, row.getByRole("button", { name: "Change role" }), "Change role");

        const group = roleGroup(row);
        await expect(group).toHaveCount(1);
        const done = row.getByRole("button", { name: "Done" });
        await expect(done).toBeVisible();
        await expect(row.getByRole("button", { name: "Remove" })).toHaveCount(0);

        for (const label of ROLE_LABELS) {
          await expectReachable(group.getByRole("button", { name: label, exact: true }), `role ${label}`);
        }
        await expectReachable(done, "Done");

        // Where the editor lives depends on whether the table has room for it.
        if (w.width >= 1316) {
          await expect(insidePinned(row), "editor stays inline in the pinned cell on a wide table").toHaveCount(1);
        }
        if (w.width >= 1024) {
          const o = await page.getByRole("region", { name: "Members" }).evaluate((n) => n.scrollWidth - n.clientWidth);
          expect(o, "table does not overflow while the editor is open").toBeLessThanOrEqual(1);
        }
        if (w.width <= 640) {
          await expect(insidePinned(row), "editor is out of the pinned column on a narrow table").toHaveCount(0);
        }

        await clickInPlace(page, group.getByRole("button", { name: "Admin", exact: true }), "Admin");
        await expect.poll(() => api.callsTo("PATCH", "/members/mem_arjun").length).toBe(1);
        expect(api.callsTo("PATCH", "/members/mem_arjun")[0]!.body).toEqual({ role: "admin" });
        await expect(group.getByRole("button", { name: "Admin", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expectNoPageOverflow(page);

        await clickInPlace(page, done, "Done");
        await expect(group).toHaveCount(0);
        await expectReachable(row.getByRole("button", { name: "Change role" }), "Change role after Done");
        await expectReachable(row.getByRole("button", { name: "Remove" }), "Remove after Done");
      });

      test("Escape closes the editor", async ({ page }) => {
        const { row } = await openTeam(page, theme);
        await clickInPlace(page, row.getByRole("button", { name: "Change role" }), "Change role");
        await roleGroup(row).getByRole("button", { name: "Viewer", exact: true }).focus();
        await page.keyboard.press("Escape");
        await expect(roleGroup(row)).toHaveCount(0);
      });

      test("Remove confirms inline: Keep and Remove are reachable, confirming sends the DELETE", async ({ page }) => {
        const { api, row } = await openTeam(page, theme);
        await clickInPlace(page, row.getByRole("button", { name: "Remove" }), "Remove");
        await expectReachable(row.getByRole("button", { name: "Keep" }), "Keep");
        await expectReachable(row.getByRole("button", { name: "Remove" }), "confirm Remove");
        expect(api.callsTo("DELETE", "/members/mem_arjun")).toHaveLength(0);
        await clickInPlace(page, row.getByRole("button", { name: "Remove" }), "confirm Remove");
        await expect.poll(() => api.callsTo("DELETE", "/members/mem_arjun").length).toBe(1);
      });

      test("the actions header sits over its cells", async ({ page }) => {
        const { row } = await openTeam(page, theme);
        const table = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "2FA" }) });
        await expectHeaderAligned(table.getByRole("columnheader", { name: "Actions" }), row.getByRole("cell").last(), "Team actions column");
      });
    });
  }
}
