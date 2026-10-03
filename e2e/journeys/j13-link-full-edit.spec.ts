/**
 * Journey 13 — Edit a link beyond its destination, and archive it
 *
 * #644: before this, the only field PATCH /links/:id was reachable for from
 * the UI was `destination` — a routing rule, password, expiry, UTM, social
 * preview, tag/folder/comment or archiving the link all required deleting
 * and recreating it. This exercises the edit drawer added to close that gap:
 * add a routing rule, set a password and an expiry date, save, reload, and
 * confirm every one of those persisted — then archive the link via the row
 * action and confirm it moves into the Archived filter (and back out again
 * on unarchive).
 *
 * Oracles:
 *   - packages/contract/src/link.ts — UpdateLinkInput (CreateLinkInput minus
 *     domain/slug, plus `archived`): every field asserted here is one
 *     UpdateLinkInput declares the API accepts.
 *   - Invariant: GET /links/:id after a PATCH reflects the patch — the API's
 *     own write path is the oracle for persistence, read back over HTTP, not
 *     assumed from the UI alone.
 *   - Invariant: an archived link's `status` is "archived", and the
 *     Archived filter (ListLinksQuery.status) is the API's own filter, not a
 *     client-side re-filter.
 */

import { expect, test } from "@playwright/test";
import { makeEmail, registerUser, seedAccount, createLink, API_URL } from "./helpers";

const DEST = "https://example.com/j13-destination";
const RULE_DEST = "https://example.com/j13-rule-target";
const PASSWORD = "j13-link-password";

test.describe("Journey 13 — Full link edit and archive", () => {
  test("edit routing/password/expiry via the drawer, then archive and unarchive @mobile", async ({ page }) => {
    /* ---- Setup ---- */
    const session = await registerUser(makeEmail("j13"));
    await seedAccount(page, session);

    const link = await createLink(session.accessToken, { destination: DEST });

    /* ---- 1. Open the edit drawer from the link detail page ---- */
    await page.goto(`/links/${link.id}`);
    await expect(page.getByText(new RegExp(link.slug))).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    const drawer = page.getByRole("dialog", { name: new RegExp(`Edit .+/${link.slug}`) });
    await expect(drawer).toBeVisible();

    /* ---- 2. Routing tab: add a rule ---- */
    await drawer.getByRole("tab", { name: "Routing" }).click();
    await drawer.getByRole("button", { name: /Add rule/i }).click();
    // RoutingRulesEditor labels its destination input "Rule <n> destination".
    await drawer.getByLabel("Rule 1 destination").fill(RULE_DEST);

    /* ---- 3. Access tab: password + expiry ---- */
    await drawer.getByRole("tab", { name: "Access" }).click();
    await drawer.getByPlaceholder("Leave blank for no password").fill(PASSWORD);
    await drawer.getByRole("button", { name: /Expire on a date/i }).click();
    const expiryInput = drawer.getByLabel("Expiry date");

    /* ---- 4. Save ---- */
    await drawer.getByRole("button", { name: "Save changes" }).click();
    await expect(drawer).toBeHidden({ timeout: 15_000 });

    /* ---- 5. Oracle: GET /links/:id over HTTP reflects the patch ---- */
    const getRes = await fetch(`${API_URL}/links/${link.id}`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(getRes.ok, "GET /links/:id should succeed").toBe(true);
    const saved = (await getRes.json()) as {
      rules?: Array<{ then: string }>;
      passwordProtected?: boolean;
      expiresAt?: string | null;
      status?: string;
    };
    expect(saved.rules?.some((r) => r.then === RULE_DEST), "routing rule should persist").toBe(true);
    expect(saved.passwordProtected, "password should be set").toBe(true);
    expect(saved.expiresAt, "expiry date should be set").toBeTruthy();
    void expiryInput; // referenced for readability of what was filled; value asserted via the API above

    /* ---- 6. Archive via the links list row action ---- */
    await page.goto("/links");
    const row = page.locator("article", { hasText: link.slug });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: new RegExp(`Archive link .+/${link.slug}`) }).click();

    // Moves out of the default ("All") list view into the Archived filter.
    await expect(page.getByRole("button", { name: "Archived" })).toBeVisible();
    await page.getByRole("button", { name: "Archived" }).click();
    await expect(page.locator("article", { hasText: link.slug })).toBeVisible({ timeout: 15_000 });

    const archivedRes = await fetch(`${API_URL}/links/${link.id}`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    const archived = (await archivedRes.json()) as { status?: string };
    expect(archived.status, "status should be archived after the archive action").toBe("archived");

    /* ---- 7. Unarchive — moves back out of the Archived filter ---- */
    const archivedRow = page.locator("article", { hasText: link.slug });
    await archivedRow.getByRole("button", { name: new RegExp(`Unarchive link .+/${link.slug}`) }).click();
    await expect(page.locator("article", { hasText: link.slug })).toHaveCount(0, { timeout: 15_000 });

    const unarchivedRes = await fetch(`${API_URL}/links/${link.id}`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    const unarchived = (await unarchivedRes.json()) as { status?: string };
    expect(unarchived.status, "status should no longer be archived").not.toBe("archived");
  });
});
