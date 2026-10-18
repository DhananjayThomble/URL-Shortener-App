import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, nestError, seedMockSession, type MockReply } from "../support/mock-api";

/* E2E (#781): Team > Change role.

   Before: picking a role in the inline editor saved it and CLOSED the editor on
   the spot. The row's actions swapped from [role options][Done] back to
   [Change role][Remove], so the destructive "Remove" landed where "Done" had been
   a moment earlier. Someone moving to click Done opened the Keep / Remove
   confirmation instead.

   Now the editor stays open until the person closes it (Done or Esc), the result
   is announced in a status line BELOW the table (reserved, so nothing above or
   beside the row moves), and "Remove" is not rendered while the editor is open.
   Remove keeps its Keep / Remove confirmation.

   The spec measures geometry rather than trusting the DOM: it records the boxes
   of the role options and of Done before the change, then asserts that after the
   change (a) nothing moved, and (b) the element under the old positions is not
   the destructive control, and that a real mouse click there does not open the
   confirmation. Real API client against browser-level answers (the 400 / 403
   bodies are the ones apps/api/src/members/members.service.ts and the Roles guard
   send); the CI lane has chromium only, so both phones run as chromium with the
   device's viewport, touch and UA, and WebKit is covered in the real-stack run. */

type Role = "owner" | "admin" | "editor" | "viewer";
type MockMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited";
  links: number;
  lastActive: string | null;
  invitedAt: string | null;
  twoFactor: boolean;
  initials: string;
};

const member = (id: string, name: string, role: Role, extra: Partial<MockMember> = {}): MockMember => ({
  id,
  name,
  email: `${name.split(" ")[0]!.toLowerCase()}@mock.test`,
  role,
  status: "active",
  links: 4,
  lastActive: "2026-10-17T08:00:00.000Z",
  invitedAt: null,
  twoFactor: true,
  initials: name
    .split(" ")
    .map((p) => p[0])
    .join(""),
  ...extra,
});

const ARJUN = member("mem_arjun", "Arjun Kapoor", "editor");

async function openTeam(page: Page, opts: { patchReply?: (id: string, role: Role) => MockReply | null } = {}) {
  const store: MockMember[] = [member("mem_owner", "Mock Owner", "owner"), ARJUN, member("mem_priya", "Priya Nair", "viewer")].map((m) => ({ ...m }));
  const handlers: Parameters<typeof mockApi>[1] = {
    "GET /auth/me": { status: 200, body: { ...MOCK_USER } },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /members": () => ({ status: 200, body: store }),
    "GET /audit": { status: 200, body: [] },
    "GET /domains": { status: 200, body: [] },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
  };
  for (const m of store) {
    handlers[`PATCH /members/${m.id}`] = (req) => {
      const role = (req.body as { role: Role }).role;
      const refusal = opts.patchReply?.(m.id, role);
      if (refusal) return refusal;
      m.role = role;
      return { status: 204 };
    };
    handlers[`DELETE /members/${m.id}`] = () => {
      store.splice(store.findIndex((x) => x.id === m.id), 1);
      return { status: 204 };
    };
  }
  await seedMockSession(page);
  const api = await mockApi(page, handlers);
  await page.goto("/team");
  const row = page.getByRole("row", { name: /Arjun Kapoor/ });
  await expect(row).toBeVisible();
  return { api, store, row };
}

type Box = { x: number; y: number; width: number; height: number };
const need = (b: Box | null): Box => {
  if (!b) throw new Error("element has no bounding box");
  return b;
};
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const close = (a: Box, b: Box) => {
  for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(a[k] - b[k]), `${k} moved`).toBeLessThanOrEqual(1);
};

/** The accessible text of the button under a viewport point, or null when it is not a button. */
async function buttonAt(page: Page, p: { x: number; y: number }): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)?.closest("button");
    return el ? (el.textContent ?? "").trim() : null;
  }, p);
}

const statusLine = (page: Page) => page.getByRole("status").filter({ hasText: /role is now|can.t|only owner/i });
const roleGroup = (row: Locator) => row.getByRole("group", { name: /Role for/ });

const VIEWPORTS = [
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  { name: "iPhone 15 (393px)", use: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15"].userAgent } },
  { name: "Pixel 7", use: { viewport: devices["Pixel 7"].viewport, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent } },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`Team > Change role layout (#781) — ${vp.name}`, () => {
    test.use(vp.use);

    test("choosing a role saves it, keeps the editor open, and nothing destructive takes the place of the controls", async ({ page }) => {
      const { api, row } = await openTeam(page);

      // Remove, as it sits before the editor is opened.
      const removeBefore = need(await row.getByRole("button", { name: "Remove" }).boundingBox());
      await row.getByRole("button", { name: "Change role" }).click();

      const group = roleGroup(row);
      const admin = group.getByRole("button", { name: "Admin" });
      const done = row.getByRole("button", { name: "Done" });
      await expect(done).toBeVisible();
      await done.scrollIntoViewIfNeeded();
      await expect(row.getByRole("button", { name: "Remove" })).toHaveCount(0);

      const adminBefore = need(await admin.boundingBox());
      const doneBefore = need(await done.boundingBox());
      const rowBefore = need(await row.boundingBox());
      const tableTopBefore = need(await page.getByRole("table").first().boundingBox()).y;

      await admin.click();

      // The change is confirmed, in words, and really sent.
      await expect(statusLine(page)).toContainText("Arjun Kapoor");
      await expect(statusLine(page)).toContainText("Admin");
      expect(api.callsTo("PATCH", "/members/mem_arjun")).toHaveLength(1);
      expect(api.callsTo("PATCH", "/members/mem_arjun")[0]!.body).toEqual({ role: "admin" });
      // The server's answer is what is shown: the role chip and the pressed option.
      await expect(row.getByText("Admin", { exact: true }).first()).toBeVisible();
      await expect(admin).toHaveAttribute("aria-pressed", "true");

      // Editor is still open; the destructive action is not on the row at all.
      await expect(done).toBeVisible();
      await expect(row.getByRole("button", { name: "Remove" })).toHaveCount(0);
      await expect(row.getByRole("button", { name: "Keep" })).toHaveCount(0);

      // Nothing moved: not the options, not Done, not the row, not the table.
      close(adminBefore, need(await admin.boundingBox()));
      close(doneBefore, need(await done.boundingBox()));
      close(rowBefore, need(await row.boundingBox()));
      expect(Math.abs(need(await page.getByRole("table").first().boundingBox()).y - tableTopBefore)).toBeLessThanOrEqual(1);

      // Whatever Remove occupies now (nothing), it is not where the old controls were.
      for (const old of [adminBefore, doneBefore]) {
        expect(await buttonAt(page, centre(old))).not.toBe("Remove");
        const removeNow = row.getByRole("button", { name: "Remove" });
        if ((await removeNow.count()) > 0) expect(intersects(need(await removeNow.boundingBox()), old)).toBe(false);
      }
      expect(removeBefore.width).toBeGreaterThan(0);

      // A real click at the old role-control position does not open the confirmation...
      await page.mouse.click(centre(adminBefore).x, centre(adminBefore).y);
      await expect(row.getByRole("button", { name: "Keep" })).toHaveCount(0);
      await expect(row.getByRole("button", { name: "Remove" })).toHaveCount(0);
      // ...and picking the role it already has is not a second request.
      expect(api.callsTo("PATCH", "/members/mem_arjun")).toHaveLength(1);

      // A real click where Done was closes the editor; still no confirmation.
      await page.mouse.click(centre(doneBefore).x, centre(doneBefore).y);
      await expect(row.getByRole("button", { name: "Change role" })).toBeVisible();
      await expect(row.getByRole("button", { name: "Keep" })).toHaveCount(0);
      expect(api.callsTo("DELETE", "/members/mem_arjun")).toHaveLength(0);
    });

    test("a refused change keeps the editor open, says why under the table, and moves nothing", async ({ page }) => {
      const message = "This is the only owner. Make someone else an owner first.";
      const { api, row } = await openTeam(page, { patchReply: (id) => (id === "mem_arjun" ? nestError(400, message, "Bad Request") : null) });
      await row.getByRole("button", { name: "Change role" }).click();
      const done = row.getByRole("button", { name: "Done" });
      await done.scrollIntoViewIfNeeded();
      const doneBefore = need(await done.boundingBox());
      const rowBefore = need(await row.boundingBox());
      const tableTopBefore = need(await page.getByRole("table").first().boundingBox()).y;

      await roleGroup(row).getByRole("button", { name: "Viewer" }).click();

      await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
      expect(api.callsTo("PATCH", "/members/mem_arjun")).toHaveLength(1);
      await expect(done).toBeVisible();
      await expect(row.getByRole("button", { name: "Remove" })).toHaveCount(0);
      // The unchanged role is still the pressed one.
      await expect(roleGroup(row).getByRole("button", { name: "Editor" })).toHaveAttribute("aria-pressed", "true");
      close(doneBefore, need(await done.boundingBox()));
      close(rowBefore, need(await row.boundingBox()));
      expect(Math.abs(need(await page.getByRole("table").first().boundingBox()).y - tableTopBefore)).toBeLessThanOrEqual(1);
      expect(await buttonAt(page, centre(doneBefore))).toBe("Done");
    });

    test("a 403 from the API (role not allowed to manage members) is shown in words, not as a raw status", async ({ page }) => {
      const { row } = await openTeam(page, { patchReply: () => nestError(403, "Your role can't do that.", "Forbidden") });
      await row.getByRole("button", { name: "Change role" }).click();
      await roleGroup(row).getByRole("button", { name: "Admin" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Your role can't do that." })).toBeVisible();
      await expect(row.getByRole("button", { name: "Done" })).toBeVisible();
    });

    test("Remove still asks first: Keep cancels without a request, Remove then sends exactly one", async ({ page }) => {
      const { api, row } = await openTeam(page);
      await row.getByRole("button", { name: "Remove" }).click();
      await expect(row.getByRole("button", { name: "Keep" })).toBeVisible();
      expect(api.callsTo("DELETE", "/members/mem_arjun")).toHaveLength(0);

      await row.getByRole("button", { name: "Keep" }).click();
      await expect(row.getByRole("button", { name: "Change role" })).toBeVisible();
      expect(api.callsTo("DELETE", "/members/mem_arjun")).toHaveLength(0);

      await row.getByRole("button", { name: "Remove" }).click();
      await row.getByRole("button", { name: "Remove" }).click();
      await expect(page.getByRole("row", { name: /Arjun Kapoor/ })).toHaveCount(0);
      expect(api.callsTo("DELETE", "/members/mem_arjun")).toHaveLength(1);
    });
  });
}

test.describe("Team > Change role (#781) — keyboard", () => {
  test("Esc closes the editor without a request, and Done works from the keyboard", async ({ page }) => {
    const { api, row } = await openTeam(page);
    await row.getByRole("button", { name: "Change role" }).click();
    await roleGroup(row).getByRole("button", { name: "Admin" }).focus();
    await page.keyboard.press("Escape");
    await expect(roleGroup(row)).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Change role" })).toBeVisible();
    expect(api.callsTo("PATCH", "/members/mem_arjun")).toHaveLength(0);

    await row.getByRole("button", { name: "Change role" }).click();
    await roleGroup(row).getByRole("button", { name: "Viewer" }).focus();
    await page.keyboard.press("Enter");
    await expect(statusLine(page)).toContainText("Viewer");
    await row.getByRole("button", { name: "Done" }).focus();
    await page.keyboard.press("Enter");
    await expect(row.getByRole("button", { name: "Change role" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Keep" })).toHaveCount(0);
  });
});

test.describe("Team > Change role (#781) — double submit", () => {
  test("two fast clicks on the same new role send one request", async ({ page }) => {
    const { api, row } = await openTeam(page);
    await row.getByRole("button", { name: "Change role" }).click();
    await roleGroup(row).getByRole("button", { name: "Admin" }).dblclick();
    await expect(statusLine(page)).toContainText("Admin");
    expect(api.callsTo("PATCH", "/members/mem_arjun")).toHaveLength(1);
  });
});
