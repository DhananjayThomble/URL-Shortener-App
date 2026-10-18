/**
 * Journey 787 — Links grid view layout (#787)
 *
 * A hyphenated slug wrapped mid-word ("qa-" / "full"), the destination was cut with
 * no ellipsis and a card left a gap. A real user does this:
 *   create links with a hyphenated slug and a long destination -> open Links -> Grid.
 *
 * Oracles (independent of the layout code):
 *   - the slug and destination the API stored (POST /links reply),
 *   - measured geometry: one text line per slug/destination, no horizontal scroll,
 *     the destination starts at the host and carries the stored URL in `title`.
 *
 * Requires the local staging stack and the web app on :3000 — see
 * playwright.journeys.config.ts.
 */

import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { API_URL, RUN_PASSWORD, makeEmail, registerUser, type Session } from "./helpers";

const SHOTS = process.env.QA_787_SHOTS ?? path.resolve(__dirname, "../../.qa-runs/787");
const LONG_PATH = `/products/category/very-long-product-name-that-goes-on/and-on?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale-${"x".repeat(40)}`;

async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function create(session: Session, domain: string, slug: string, destination: string) {
  const res = await fetch(`${API_URL}/links`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ destination, domain, slug }),
  });
  const text = await res.text();
  expect(res.ok, `POST /links → ${res.status} ${text.slice(0, 300)}`).toBe(true);
  return JSON.parse(text) as { id: string; slug: string; destination: string };
}

test.describe("Journey 787 — Links grid layout", () => {
  test("hyphenated slug stays on one line and the destination keeps its host @mobile", async ({ page }, info) => {
    const session = await registerUser(makeEmail("j787"));
    const ws = (await (await fetch(`${API_URL}/workspaces/current`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    })).json()) as { defaultDomain?: string };
    const domain = ws.defaultDomain ?? "localhost:3002";
    const tag = Date.now().toString(36);
    const links = [
      await create(session, domain, `qa-full-${tag}`, `https://www.example.com${LONG_PATH}`),
      await create(session, domain, `qa-full-campaign-spring-sale-extended-edition-${tag}`, `https://example.org${LONG_PATH}`),
    ];
    await signIn(page, session);
    await page.goto("/links");
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(links.length, { timeout: 15_000 });
    await page.mouse.move(0, 0);

    for (const link of links) {
      const card = page.locator("article", { hasText: link.slug });
      await expect(card).toBeVisible();
      const m = await card.evaluate((a) => {
        const lines = (el: Element) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return new Set(Array.from(r.getClientRects()).filter((c) => c.width > 0).map((c) => Math.round(c.top))).size;
        };
        const slug = a.querySelector("[data-slot='slug']")!;
        const dest = a.querySelector("[data-slot='destination-text']") as HTMLElement;
        return {
          slugLines: lines(slug),
          destLines: lines(dest),
          destText: dest.textContent ?? "",
          destTitle: dest.getAttribute("title"),
          ellipsis: getComputedStyle(dest).textOverflow,
          cardOverflow: a.scrollWidth - a.clientWidth,
          docOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expect(m.slugLines, `${link.slug} wrapped`).toBe(1);
      expect(m.destLines, "destination wrapped").toBe(1);
      expect(m.destTitle, "full destination on hover = what the API stored").toBe(link.destination);
      expect(m.destText.startsWith(link.destination.replace(/^https?:\/\//, "").slice(0, 20))).toBe(true);
      expect(m.ellipsis).toBe("ellipsis");
      expect(m.cardOverflow).toBeLessThanOrEqual(1);
      expect(m.docOverflow).toBeLessThanOrEqual(0);
    }
    await page.screenshot({ path: path.join(SHOTS, `real-stack-${info.project.name}-grid.png`) });
  });
});
