/**
 * Journey 788 — the bio editor's preview is the public page; initials are
 * letters; a bad block URL is flagged on its block.
 *
 * QA saw (1) the /bio preview differ from the public page (other link styling,
 * other footer), (2) the avatar for a name containing "<" read "Q<", and
 * (3) a bad block URL reported only in a banner at the top of the page.
 *
 * Oracles:
 *   - packages/contract — UpsertBioPageInput / HttpUrl ("Enter an absolute
 *     http(s) URL"), PublicBioPage.profile.initials
 *   - packages/domain initials.ts — letters only: "QA <User>" -> "QU"
 *   - the PUBLIC page (/b/<domain>/<slug>, signed out) is the reference the
 *     editor's preview must match.
 *
 * Runs against the real stack: the REAL API stores the page, computes the
 * initials the public page shows, and refuses nothing here — the editor refuses
 * the bad URL client-side, so no request may reach it.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { expect, test, type Locator } from "@playwright/test";
import { API_URL, RUN_ID, makeEmail, registerUser, seedAccount } from "./helpers";

const EVIDENCE = path.resolve(__dirname, "../../.qa-runs/788");

const STYLE_PROPS = [
  "backgroundColor", "color", "borderTopColor", "borderTopWidth", "borderRadius",
  "fontFamily", "fontSize", "fontWeight", "paddingTop", "paddingLeft", "textAlign",
];

async function describeCard(root: Locator) {
  return root.evaluate((el, props) => {
    const look = (node: Element | null) => {
      if (!node) return { text: "<missing>", style: "" };
      const s = getComputedStyle(node) as unknown as Record<string, string>;
      return {
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
        style: props.map((p) => `${p}=${s[p]}`).join(";"),
      };
    };
    const rows = Array.from(el.querySelectorAll('[data-testid="bio-card-blocks"] > *'));
    return {
      avatar: look(el.querySelector('[data-testid="bio-avatar"]')),
      name: look(el.querySelector("h1, h2")),
      bio: look(el.querySelector("header p")),
      rows: rows.map(look),
      footer: look(Array.from(el.querySelectorAll("p")).pop() ?? null),
    };
  }, STYLE_PROPS);
}

test.describe("Journey 788 — bio preview parity, initials, inline URL errors @mobile", () => {
  test("preview matches the public page; 'QA <User>' is QU; a bad URL is flagged on its block", async ({ page, browser }, testInfo) => {
    mkdirSync(EVIDENCE, { recursive: true });
    const tag = testInfo.project.name;

    /* ---- Setup: a live page with a markup-looking name, via the real API ---- */
    const session = await registerUser(makeEmail(`j788-${tag}`));
    const auth = { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" };
    const ws = (await (await fetch(`${API_URL}/workspaces/current`, { headers: auth })).json()) as { defaultDomain: string };
    const domain = ws.defaultDomain;
    const slug = `j788${randomBytes(3).toString("hex")}`;
    const put = await fetch(`${API_URL}/bio-pages`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        domain,
        slug,
        status: "live",
        profile: { name: "QA <User>", bio: `Notes ${RUN_ID}` },
        blocks: [
          { kind: "link", title: "First link", subtitle: "with a subtitle", href: "https://example.com/j788-a", locked: false },
          { kind: "social", title: "Second link", subtitle: null, href: "https://example.com/j788-b", locked: false },
          { kind: "email", title: "Third link", subtitle: null, href: "https://example.com/j788-c", locked: false },
        ],
      }),
    });
    expect(put.status, `PUT /bio-pages -> ${await put.clone().text()}`).toBe(200);

    /* ---- The API's own initials for that name: letters, not "Q<" ---- */
    const pub = (await (await fetch(`${API_URL}/public/bio-pages/by-domain/${encodeURIComponent(domain)}/${slug}`)).json()) as {
      profile: { initials: string };
    };
    expect(pub.profile.initials).toBe("QU");

    /* ---- The public page, as a signed-out visitor ---- */
    const visitor = await browser.newContext({ ...testInfo.project.use });
    const anon = await visitor.newPage();
    // The slug alias (/b/<slug>) renders the very same BioPageView as the
    // per-domain route. It is used here because the staging shared domain
    // carries a port ("localhost:3002") and the per-domain route's server-side
    // existence probe percent-encodes that colon twice, 404ing every such page
    // (tracked separately; production domains have no port).
    await anon.goto(`/b/${slug}`, { waitUntil: "networkidle" });
    await expect(anon.getByRole("heading", { level: 1, name: "QA <User>" })).toBeVisible();
    await anon.screenshot({ path: path.join(EVIDENCE, `public-${tag}.png`), fullPage: true });
    const publicCard = await describeCard(anon.locator("main"));
    await visitor.close();
    expect(publicCard.avatar.text).toBe("QU");

    /* ---- The editor's preview of the same page ---- */
    await seedAccount(page, session);
    await page.goto("/bio");
    await page.getByRole("row", { name: new RegExp(`/${slug}`) }).getByRole("button", { name: "Edit" }).click();
    const preview = page.getByTestId("bio-preview");
    await expect(preview.getByRole("heading", { name: "QA <User>" })).toBeVisible();
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(EVIDENCE, `editor-${tag}.png`), fullPage: true });
    const previewCard = await describeCard(preview);

    expect(previewCard.avatar).toEqual(publicCard.avatar);
    expect(previewCard.name).toEqual(publicCard.name);
    expect(previewCard.bio).toEqual(publicCard.bio);
    expect(previewCard.footer).toEqual(publicCard.footer);
    expect(previewCard.rows).toEqual(publicCard.rows);
    expect(new Set(previewCard.rows.map((r) => r.style)).size, "every link row has one look").toBe(1);

    /* ---- A bad block URL: flagged on its block, nothing sent ---- */
    const puts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PUT" && r.url().includes("/bio-pages")) puts.push(r.url());
    });
    await page.getByRole("button", { name: "Edit block “Second link”" }).click();
    const url = page.getByLabel("URL", { exact: true });
    await url.fill("not a url");
    await page.getByRole("button", { name: "Save changes" }).click();

    const block = page.getByTestId("bio-block").filter({ hasText: "Second link" });
    await expect(block.getByText("Enter an absolute http(s) URL")).toBeVisible();
    await expect(url).toHaveAttribute("aria-invalid", "true");
    await expect(url).toBeFocused();
    await block.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(EVIDENCE, `inline-error-${tag}.png`), fullPage: true });
    // The other blocks are not accused, and the bad value was never sent.
    await expect(page.getByTestId("bio-block").filter({ hasText: "First link" }).getByText("Enter an absolute")).toHaveCount(0);
    expect(puts).toHaveLength(0);

    /* ---- Fix it: the error clears and the save lands in the real API ---- */
    await url.fill("https://example.com/j788-fixed");
    await expect(page.getByText("Enter an absolute http(s) URL")).toHaveCount(0);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    const pages = (await (await fetch(`${API_URL}/bio-pages`, { headers: auth })).json()) as Array<{
      slug: string;
      blocks: Array<{ title: string; href: string }>;
    }>;
    const saved = pages.find((p) => p.slug === slug)!;
    expect(saved.blocks.find((b) => b.title === "Second link")?.href).toBe("https://example.com/j788-fixed");
  });
});
