import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* Issue #461 — decorative nav icon glyphs must not pollute the accessible name
   of primary navigation controls.

   Oracle: accessible-name computation per WCAG 2.1 SC 4.1.2 / the accname spec.
   A decorative glyph placed ahead of a control's visible label must be excluded
   from the computed accessible name (aria-hidden or role="presentation" on the
   glyph element) — the accessible name should be the destination text only.
   This is not a judgement call: it is read directly off the accessibility tree
   via the Chrome DevTools Protocol, independent of how Playwright's own
   getByRole substring matching happens to behave.

   web/src/components/app-shell/index.tsx renders every primary nav item's icon
   glyph in a single shared <NavLinks> component (used verbatim by both the
   desktop <Sidebar> and the mobile drawer, so this check covers both surfaces
   at once), plus one more decorative glyph specific to the desktop sidebar: the
   workspace-switcher chevron ("▾"). */

const GLYPHS = ["⛓", "▤", "▩", "☰", "▧", "⇄", "◈", "⚑", "⌘", "◐", "⚙", "▾", "✕", "⌕"];

function containsDecorativeGlyph(name: string): boolean {
  return GLYPHS.some((g) => name.includes(g));
}

/** Read the accessible name of every node in the CDP accessibility tree that has
 *  an interactive/link/button role, scoped to a given DOM container selector. */
async function accessibleNamesWithin(page: import("@playwright/test").Page, containerSelector: string) {
  const client = await page.context().newCDPSession(page);
  await client.send("Accessibility.enable");
  const { nodes } = await client.send("Accessibility.getFullAXTree");
  await client.send("Accessibility.disable");

  // Resolve which AX nodes fall within the container by checking each node's
  // backend DOM node against the container using an in-page containment check.
  const containerHandle = await page.$(containerSelector);
  if (!containerHandle) throw new Error(`container not found: ${containerSelector}`);

  const results: { role: string; name: string }[] = [];
  for (const node of nodes) {
    const role = node.role?.value;
    if (role !== "link" && role !== "button") continue;
    const name = node.name?.value ?? "";
    if (!node.backendDOMNodeId) continue;
    // DOM.resolveNode + containment check.
    const { object } = await client.send("DOM.resolveNode", { backendNodeId: node.backendDOMNodeId });
    if (!object?.objectId) continue;
    const isInside = await client.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function(containerSel) {
        const container = document.querySelector(containerSel);
        return !!container && container.contains(this);
      }`,
      arguments: [{ value: containerSelector }],
      returnByValue: true,
    });
    if (isInside.result.value) results.push({ role, name });
  }
  return results;
}

test.describe("primary navigation accessible names carry no decorative glyph (#461)", () => {
  test("desktop sidebar", async ({ page }) => {
    test.info().annotations.push({ type: "viewport", description: "desktop" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page);
    await page.goto("/links");
    await page.waitForLoadState("networkidle").catch(() => {});

    const sidebar = page.getByRole("complementary");
    await expect(sidebar).toBeVisible();

    const names = await accessibleNamesWithin(page, "aside");
    expect(names.length).toBeGreaterThan(0);
    const polluted = names.filter((n) => containsDecorativeGlyph(n.name));
    expect(polluted, `polluted accessible names: ${JSON.stringify(polluted, null, 2)}`).toEqual([]);
  });

  test("mobile nav drawer", async ({ page }) => {
    test.info().annotations.push({ type: "viewport", description: "mobile" });
    await page.setViewportSize({ width: 390, height: 852 });
    await seedSession(page);
    await page.goto("/links");
    await page.waitForLoadState("networkidle").catch(() => {});

    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();

    const names = await accessibleNamesWithin(page, '[role="dialog"][aria-label="Navigation"]');
    expect(names.length).toBeGreaterThan(0);
    const polluted = names.filter((n) => containsDecorativeGlyph(n.name));
    expect(polluted, `polluted accessible names: ${JSON.stringify(polluted, null, 2)}`).toEqual([]);
  });

  test("desktop workspace-switcher button name is not polluted by its chevron", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page);
    await page.goto("/links");
    await page.waitForLoadState("networkidle").catch(() => {});

    const sidebar = page.getByRole("complementary");
    const names = await accessibleNamesWithin(page, "aside");
    // The workspace-switcher <button> has no explicit aria-label, so its
    // computed name is built from its content: the initials badge (aria-hidden,
    // already excluded), the workspace name text, and the chevron glyph. Before
    // the fix the chevron was NOT aria-hidden, so the computed name ended in
    // "▾". Assert no button-role name in the sidebar contains it.
    const chevronPolluted = names.filter((n) => n.role === "button" && n.name.includes("▾"));
    expect(chevronPolluted, JSON.stringify(chevronPolluted, null, 2)).toEqual([]);
    void sidebar;
  });
});
