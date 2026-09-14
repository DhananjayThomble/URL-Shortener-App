import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* Importers PR1 (import core) — the generic-CSV path end to end in fixtures
   mode. Mirrors create-link.spec.ts: accessible-name selectors only, no CSS /
   data-testid. The import panel calls the same POST /links/bulk the fixtures
   backend already serves (fixtures.ts /links/bulk), so no fixture change is
   needed — the import rows are ordinary bulk rows.

   role=option collision note: the source/domain <select>s render <option>s, so
   assertions scope to the result <ol role via getByText/getByRole("status">
   and to the panel region, never a bare getByRole("option"). */

const FIRST_DOMAIN = "snap.to"; // fixtures DOMAINS[0]

async function openImport(page: import("@playwright/test").Page) {
  await page.goto("/links");
  await expect(page).toHaveURL(/\/links$/);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const panel = page.getByRole("button", { name: /^Import \d* ?links?$/ });
  await expect(panel).toBeVisible();
}

test.describe("import links (generic CSV core)", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("a user pastes a CSV export and sees the links imported", async ({ page }) => {
    await openImport(page);

    // Unique back-halves per run so they cannot collide with a seeded fixture.
    const s1 = `imp-${Date.now().toString(36)}`;
    const s2 = `${s1}-b`;
    const csv =
      "long_url,back_half,title\n" +
      `https://example.com/one,${s1},First imported\n` +
      `https://example.com/two,${s2},Second imported`;

    await page.getByRole("textbox", { name: "Export contents" }).fill(csv);

    // The default domain is the first fixture domain; assert the picker shows it.
    await expect(page.getByRole("combobox", { name: "Import into domain" })).toHaveValue(FIRST_DOMAIN);

    await page.getByRole("button", { name: /^Import 2 links$/ }).click();

    // Result status line reports both created.
    await expect(page.getByRole("status")).toContainText("2 imported");
    // And each landed row is listed as domain/slug.
    await expect(page.locator("ol").getByText(`${FIRST_DOMAIN}/${s1}`, { exact: true })).toBeVisible();
    await expect(page.locator("ol").getByText(`${FIRST_DOMAIN}/${s2}`, { exact: true })).toBeVisible();
  });

  test("a back-half that already exists is SKIPPED, not overwritten", async ({ page }) => {
    await openImport(page);

    // `spring-sale` is a seeded link on snap.to (fixtures.ts) — importing it
    // again must be reported as skipped, and the whole batch is all-or-nothing
    // so nothing else in that batch is created either.
    const csv = "long_url,back_half\nhttps://example.com/dupe,spring-sale";
    await page.getByRole("textbox", { name: "Export contents" }).fill(csv);
    await page.getByRole("button", { name: /^Import 1 link$/ }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("0 imported");
    await expect(status).toContainText("1 skipped");
    // The row line names it as skipped rather than failed.
    await expect(page.getByText(/Skipped —/)).toBeVisible();
  });

  test("fields SnapURL cannot store are disclosed before import", async ({ page }) => {
    await openImport(page);

    const csv = "url,created,clicks\nhttps://example.com/x,2020-01-01,999";
    await page.getByRole("textbox", { name: "Export contents" }).fill(csv);

    // The dropped-field notice appears without submitting.
    await expect(page.getByText("Original created date")).toBeVisible();
    await expect(page.getByText("Click history")).toBeVisible();
  });
});

test.describe("import links (Bitly source)", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("a Bitly export imports, deriving the back-half from the Bitlink URL", async ({ page }) => {
    await page.goto("/links");
    await page.getByRole("button", { name: "Import", exact: true }).click();

    // Choose the Bitly source.
    await page.getByRole("combobox", { name: "Import source" }).selectOption({ label: "Bitly" });

    const key = `bl${Date.now().toString(36)}`;
    const csv =
      "Bitlink,Title,Long URL,Tags\n" +
      `https://bit.ly/${key},Spring Sale,https://example.com/spring,"promo, seasonal"`;
    await page.getByRole("textbox", { name: "Export contents" }).fill(csv);

    await page.getByRole("button", { name: /^Import 1 link$/ }).click();

    await expect(page.getByRole("status")).toContainText("1 imported");
    // The derived back-half (last path segment of the Bitlink) lands under the domain.
    await expect(page.locator("ol").getByText(`${FIRST_DOMAIN}/${key}`, { exact: true })).toBeVisible();
  });
});

test.describe("import links (YOURLS source)", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("a YOURLS export imports, using the bare keyword as the back-half", async ({ page }) => {
    await page.goto("/links");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByRole("combobox", { name: "Import source" }).selectOption({ label: "YOURLS" });

    const kw = `y${Date.now().toString(36)}`;
    const csv = "keyword,url,title,clicks\n" + `${kw},https://example.com/y,Landing,7`;
    await page.getByRole("textbox", { name: "Export contents" }).fill(csv);

    // The dropped-field notice discloses the clicks column before submit
    // (full li text is unique — the bare word "Clicks" appears all over the shell).
    await expect(page.getByText("Historical click counts are not imported.")).toBeVisible();

    await page.getByRole("button", { name: /^Import 1 link$/ }).click();
    await expect(page.getByRole("status")).toContainText("1 imported");
    await expect(page.locator("ol").getByText(`${FIRST_DOMAIN}/${kw}`, { exact: true })).toBeVisible();
  });
});

test.describe("import links (Kutt source)", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("a Kutt JSON export imports, mapping target + address", async ({ page }) => {
    await page.goto("/links");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByRole("combobox", { name: "Import source" }).selectOption({ label: "Kutt" });

    const addr = `k${Date.now().toString(36)}`;
    const json = JSON.stringify([
      { address: addr, target: "https://example.com/kutt", description: "From Kutt", created_at: "2021-01-01" },
    ]);
    await page.getByRole("textbox", { name: "Export contents" }).fill(json);

    // created_at is disclosed as dropped (unique li sentence, not the bare word).
    await expect(page.getByText("Imported links are dated at import time.").first()).toBeVisible();

    await page.getByRole("button", { name: /^Import 1 link$/ }).click();
    await expect(page.getByRole("status")).toContainText("1 imported");
    await expect(page.locator("ol").getByText(`${FIRST_DOMAIN}/${addr}`, { exact: true })).toBeVisible();
  });
});


test.describe("import links (Dub source)", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("a Dub export imports, using the Key as the back-half", async ({ page }) => {
    await page.goto("/links");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByRole("combobox", { name: "Import source" }).selectOption({ label: "Dub" });

    const key = `d${Date.now().toString(36)}`;
    const csv =
      "Key,Destination URL,Title,Description,Clicks\n" +
      `${key},https://example.com/dub,Launch,Our launch page,5`;
    await page.getByRole("textbox", { name: "Export contents" }).fill(csv);

    // Clicks disclosed as dropped via the unique full sentence (not the bare word).
    await expect(page.getByText("Historical click counts are not imported.")).toBeVisible();

    await page.getByRole("button", { name: /^Import 1 link$/ }).click();
    await expect(page.getByRole("status")).toContainText("1 imported");
    await expect(page.locator("ol").getByText(`${FIRST_DOMAIN}/${key}`, { exact: true })).toBeVisible();
  });
});
