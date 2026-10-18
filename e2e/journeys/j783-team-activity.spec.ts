/**
 * Journey 783 — /team "Recent activity" reads as sentences and is complete (#783)
 *
 * QA saw on /team:
 *   - a raw "form.created" next to the human-readable entries;
 *   - "Changed a role from viewer to editor" — whose role?
 *   - connecting a domain and creating a bio page never appeared.
 *
 * A real owner: registers, creates a form, connects a domain, publishes a bio
 * page and invites a teammate (through the API, which is not what is under
 * test), then on /team clicks "Change role" -> "Editor" on that teammate and
 * reads the activity card. Oracle: the issue's acceptance criteria — every
 * entry is human copy (never a dotted key), the role change names the member,
 * and the domain and bio-page creations are listed.
 *
 * Requires the local staging stack + web on :3000.
 */

import path from "node:path";
import { expect, test } from "@playwright/test";
import { API_URL, makeEmail, registerUser, seedAccount, type Session } from "./helpers";

const RAW_KEY = /\b[a-z][a-z_]*\.(created|updated|deleted|added|removed|verified|invited|joined|role_changed|published|unpublished|revoked|flagged|reviewed|invite_resent)\b/;
const EVIDENCE = process.env.QA_783_EVIDENCE;

async function api(owner: Session, method: string, p: string, body?: unknown) {
  const res = await fetch(`${API_URL}${p}`, {
    method,
    headers: { authorization: `Bearer ${owner.accessToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  expect(res.ok, `${method} ${p} -> ${res.status} ${text.slice(0, 200)}`).toBe(true);
  return text ? JSON.parse(text) : undefined;
}

test.describe("Journey 783 — team activity copy @mobile", () => {
  test("every entry is a sentence; the role change names the member; domain and bio page are listed", async ({ page }, info) => {
    const owner = await registerUser(makeEmail(`j783-${info.project.name}`));
    const tag = `${Date.now().toString(36)}${info.project.name.slice(0, 1)}`;
    const mate = makeEmail(`j783-mate-${info.project.name}`);
    const host = `j783-${tag}.example.com`;
    const formSlug = `j783-f-${tag}`;
    const bioSlug = `j783-b-${tag}`;

    await api(owner, "POST", "/forms", {
      title: "Feedback",
      slug: formSlug,
      status: "live",
      description: "",
      fields: [{ label: "Name", type: "text", required: true }],
    });
    await api(owner, "POST", "/domains", { domain: host });
    await api(owner, "PUT", "/bio-pages", {
      domain: "localhost:3002",
      slug: bioSlug,
      status: "live",
      profile: { name: "Journey", bio: "" },
      blocks: [],
    });
    await api(owner, "POST", "/members", { email: mate, role: "viewer" });

    await seedAccount(page, owner);
    await page.goto("/team");
    const main = page.locator("main");
    const row = main.getByRole("row").filter({ hasText: mate });
    await expect(row).toBeVisible({ timeout: 20_000 });

    // The real click: Change role -> Editor.
    await row.getByRole("button", { name: "Change role" }).click();
    const patched = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/members\/[^/]+$/.test(r.url()));
    await main.getByRole("group", { name: `Role for ${mate}` }).getByRole("button", { name: "Editor" }).click();
    expect((await patched).status()).toBe(204);

    const card = main.getByRole("heading", { name: "Recent activity" }).locator("xpath=../..");
    await expect(card.getByText(`Changed ${mate}'s role from viewer to editor`)).toBeVisible();
    await expect(card.getByText(`Invited ${mate} as viewer`)).toBeVisible();
    await expect(card.getByText(`Created and published the bio page localhost:3002/${bioSlug}`)).toBeVisible();
    await expect(card.getByText(`Connected ${host}`)).toBeVisible();
    await expect(card.getByText(`Created the form /f/${formSlug}`)).toBeVisible();

    const text = await card.innerText();
    expect(text).not.toMatch(RAW_KEY);
    expect(text).not.toContain("Changed a role");

    if (EVIDENCE) {
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCE, `team-activity-${info.project.name}.png`), fullPage: false });
    }
  });
});
