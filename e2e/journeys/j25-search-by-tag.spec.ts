/**
 * Journey 25 — Search finds a link by its tag (#756)  @mobile
 *
 * The top-bar search placeholder reads "Search links, slugs, destinations, tags"
 * but a tag matched nothing ("No matches"). Real stack, real API.
 *
 * Oracles:
 *   - the placeholder / aria-label: "Search links, slugs, destinations, tags"
 *   - packages/contract ListLinksQuery: GET /links?search= is a plain term
 *   - isolation: another workspace's tag must not surface in this workspace
 *
 * Desktop: the top-bar combobox (hidden below `sm`, DC5). Mobile: the same
 * `?search=` powers the Links page search box, which is what a phone has.
 */

import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { API_URL, makeEmail, registerUser, seedAccount, type Session } from "./helpers";

const COMBOBOX = "Search links, slugs, destinations, tags";

async function createTaggedLink(session: Session, tags: string[]) {
  const wsRes = await fetch(`${API_URL}/workspaces/current`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  const ws = (await wsRes.json()) as { defaultDomain?: string };
  const slug = `tg-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const res = await fetch(`${API_URL}/links`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      destination: "https://example.com/tag-search-target",
      domain: ws.defaultDomain ?? "localhost:3002",
      slug,
      tags,
    }),
  });
  if (!res.ok) throw new Error(`createTaggedLink: POST /links → ${res.status}`);
  return { slug };
}

async function shoot(page: Page, name: string) {
  const dir = process.env.QA_SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

test.describe("Journey 25 — search by tag (#756)", () => {
  test("top-bar search: a tag finds the link; another workspace's tag does not", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "top-bar search is desktop/tablet only (DC5)");
    const tag = `qatag${randomBytes(3).toString("hex")}`;
    const mine = await registerUser(makeEmail("j25a"));
    const theirs = await registerUser(makeEmail("j25b"));
    const link = await createTaggedLink(mine, [tag, "second"]);
    const foreignTag = `foreign${randomBytes(3).toString("hex")}`;
    await createTaggedLink(theirs, [foreignTag]);

    await seedAccount(page, mine);
    await page.goto("/links");
    const search = page.getByRole("combobox", { name: COMBOBOX });
    await expect(search).toBeVisible();

    // Exact tag.
    await search.fill(tag);
    const listbox = page.getByRole("listbox", { name: "Link results" });
    const option = listbox.getByRole("option", { name: new RegExp(link.slug) });
    await expect(option).toBeVisible();
    await expect(page.getByText("No matches")).toHaveCount(0);
    await shoot(page, "desktop-tag-exact");

    // Partial, upper-cased.
    await search.fill(tag.slice(0, 6).toUpperCase());
    await expect(listbox.getByRole("option", { name: new RegExp(link.slug) })).toBeVisible();

    // A wildcard typed by the user is literal: "%" and "_" match nothing here.
    for (const wildcard of ["%", "_"]) {
      await search.fill(wildcard);
      await expect(page.getByText("No matches")).toBeVisible();
    }
    await shoot(page, "desktop-wildcard-no-matches");

    // The other workspace's tag is invisible to this one.
    await search.fill(foreignTag);
    await expect(page.getByText("No matches")).toBeVisible();
    await shoot(page, "desktop-foreign-tag-no-matches");

    // The tag-matched result opens its link.
    await search.fill(tag);
    await listbox.getByRole("option", { name: new RegExp(link.slug) }).click();
    await expect(page).toHaveURL(/\/links\/[^/]+$/);
    await expect(page.getByText(link.slug, { exact: false }).first()).toBeVisible();
  });

  test("links page search: a tag finds the link (phone has no top-bar search) @mobile", async ({ page }) => {
    const tag = `mtag${randomBytes(3).toString("hex")}`;
    const mine = await registerUser(makeEmail("j25c"));
    const link = await createTaggedLink(mine, [tag]);
    await createTaggedLink(mine, ["unrelated"]);

    await seedAccount(page, mine);
    await page.goto("/links");
    const box = page.getByRole("textbox", { name: "Search links" });
    await expect(box).toBeVisible();

    await box.fill(tag);
    await expect(page.getByText(link.slug).first()).toBeVisible();
    await expect(page.getByText("1 links across", { exact: false })).toBeVisible();
    await shoot(page, `${page.viewportSize()?.width ?? "x"}-links-page-tag`);
  });
});
