/**
 * Journey 781 — /team: choosing a role must not move "Remove" under the cursor (#781)
 *
 * Before: picking a role saved it and closed the editor, which swapped the row's
 * actions back to [Change role][Remove] — the destructive "Remove" landed where
 * "Done" had just been, so the next click opened the Keep / Remove confirmation.
 *
 * A real owner does: register -> /team -> ＋ Invite -> Change role -> pick a role,
 * then clicks where Done was. Oracles: the API's own member list (role stored, no
 * DELETE sent), the geometry of the real controls, and the DOM after a real mouse
 * click. Seeded session (no login), so it spends no login throttle.
 * Requires the local staging stack + web on :3000. @mobile runs it at 390px too.
 */

import { expect, test, type Page } from "@playwright/test";
import { API_URL, makeEmail, registerUser, seedAccount, type Session } from "./helpers";

type Box = { x: number; y: number; width: number; height: number };
const need = (b: Box | null): Box => {
  if (!b) throw new Error("element has no bounding box");
  return b;
};
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function buttonAt(page: Page, p: { x: number; y: number }): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)?.closest("button");
    return el ? (el.textContent ?? "").trim() : null;
  }, p);
}

const members = async (owner: Session) =>
  (await (await fetch(`${API_URL}/members`, { headers: { authorization: `Bearer ${owner.accessToken}` } })).json()) as Array<{
    id: string;
    email: string;
    role: string;
  }>;

test.describe("Journey 781 — /team role editor layout (#781) @mobile", () => {
  test("choosing a role keeps the editor open and leaves nothing destructive under the old controls", async ({ page }, info) => {
    const owner = await registerUser(makeEmail("j781-owner"));
    const teammate = makeEmail("j781-mate");
    const created = await fetch(`${API_URL}/members`, {
      method: "POST",
      headers: { authorization: `Bearer ${owner.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ email: teammate, role: "editor" }),
    });
    expect(created.status).toBe(201);

    await seedAccount(page, owner);
    await page.goto("/team");
    const row = page.getByRole("row").filter({ hasText: teammate });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Change role" }).click();
    const group = row.getByRole("group", { name: /Role for/ });
    const admin = group.getByRole("button", { name: "Admin" });
    const done = row.getByRole("button", { name: "Done" });
    await done.scrollIntoViewIfNeeded();
    const adminBefore = need(await admin.boundingBox());
    const doneBefore = need(await done.boundingBox());
    const rowBefore = need(await row.boundingBox());
    await page.screenshot({ path: `.qa-runs/781/${info.project.name}-1-editor-open.png` });

    const sent = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/members\/[^/]+$/.test(r.url()));
    await admin.click();
    expect((await sent).status()).toBe(204);

    // Confirmed in words, and the server agrees.
    await expect(page.getByRole("status").filter({ hasText: /role is now Admin/ })).toBeVisible();
    const stored = (await members(owner)).find((m) => m.email.toLowerCase() === teammate.toLowerCase());
    expect(stored?.role).toBe("admin");
    await expect(admin).toHaveAttribute("aria-pressed", "true");

    // The editor is still open, Remove is not on the row, and nothing moved.
    await expect(done).toBeVisible();
    await expect(row.getByRole("button", { name: "Remove" })).toHaveCount(0);
    for (const [was, now] of [
      [doneBefore, need(await done.boundingBox())],
      [rowBefore, need(await row.boundingBox())],
    ] as const) {
      /* Horizontally, auto table layout can nudge a column by the width
         difference of the role chip text ("Editor" -> "Admin"), a few px at most;
         vertically nothing may move. */
      expect(Math.abs(was.x - now.x)).toBeLessThanOrEqual(6);
      expect(Math.abs(was.y - now.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(was.width - now.width)).toBeLessThanOrEqual(6);
    }
    /* The options sit in a flex-1 group whose active label is bold, so choosing
       one can nudge its neighbours by a few px. What matters is that the old
       spot is still a role option, not a different control. */
    const adminNow = need(await admin.boundingBox());
    expect(Math.abs(adminBefore.y - adminNow.y)).toBeLessThanOrEqual(1);
    expect(await buttonAt(page, centre(adminBefore))).toBe("Admin");
    expect(await buttonAt(page, centre(doneBefore))).toBe("Done");
    await page.screenshot({ path: `.qa-runs/781/${info.project.name}-2-after-role-change.png` });

    // Real clicks at the old role-control spot, then at Done: no confirmation, no delete.
    await page.mouse.click(centre(adminBefore).x, centre(adminBefore).y);
    await expect(row.getByRole("button", { name: "Keep" })).toHaveCount(0);
    await page.mouse.click(centre(doneBefore).x, centre(doneBefore).y);
    await expect(row.getByRole("button", { name: "Change role" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Keep" })).toHaveCount(0);
    expect((await members(owner)).some((m) => m.email.toLowerCase() === teammate.toLowerCase())).toBe(true);

    // Remove still asks first.
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(row.getByRole("button", { name: "Keep" })).toBeVisible();
    expect((await members(owner)).some((m) => m.email.toLowerCase() === teammate.toLowerCase())).toBe(true);
    await page.screenshot({ path: `.qa-runs/781/${info.project.name}-3-remove-confirm.png` });
    await row.getByRole("button", { name: "Keep" }).click();
    await row.getByRole("button", { name: "Remove" }).click();
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("row").filter({ hasText: teammate })).toHaveCount(0);
    expect((await members(owner)).some((m) => m.email.toLowerCase() === teammate.toLowerCase())).toBe(false);
  });

  test("the only owner cannot be demoted: the refusal is shown under the table and the editor stays put", async ({ page }) => {
    const owner = await registerUser(makeEmail("j781-solo"));
    await seedAccount(page, owner);
    await page.goto("/team");
    const row = page.getByRole("row").filter({ hasText: owner.email });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Change role" }).click();
    const done = row.getByRole("button", { name: "Done" });
    await done.scrollIntoViewIfNeeded();
    const doneBefore = need(await done.boundingBox());
    await row.getByRole("group", { name: /Role for/ }).getByRole("button", { name: "Admin" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /only owner/i })).toBeVisible();
    await expect(done).toBeVisible();
    await expect(row.getByRole("button", { name: "Remove" })).toHaveCount(0);
    expect(await buttonAt(page, centre(doneBefore))).toBe("Done");
    expect((await members(owner)).find((m) => m.email.toLowerCase() === owner.email.toLowerCase())?.role).toBe("owner");
  });
});
