/**
 * Journey — lowering click-data retention asks first (#780)
 *
 * Saving a shorter retention makes the worker's maintenance pass permanently
 * delete the older raw clicks, and used to do so with no warning. A person
 * (workspace owner, fresh workspace, default 3 years) then:
 *   1. picks "1 year" in Settings > Privacy & data and presses Save: a dialog
 *      says what will be deleted and when; nothing is stored yet (read back
 *      through the API);
 *   2. cancels: "3 years" is selected again and the API still holds 3;
 *   3. tries again and confirms: the API now holds 1, and a reload agrees;
 *   4. picks "3 years" (a longer window) and saves: no question, API holds 3;
 *   5. Forever -> 1 year asks again (Forever is stored as 100).
 *
 * Oracle: the issue's acceptance criteria; GET /workspaces/current for what is
 * really stored. Screenshots (light + dark) go under .qa-runs/780/ for the PR.
 *
 * Requires the local staging stack + web on :3000. @mobile: also runs on the
 * mobile project.
 */

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { API_URL, makeEmail, registerUser, seedAccount } from "./helpers";

const SHOTS = process.env.QA_780_SHOTS ?? path.resolve(__dirname, "../../.qa-runs/780");

async function savedRetention(accessToken: string): Promise<number> {
  const res = await fetch(`${API_URL}/workspaces/current`, { headers: { authorization: `Bearer ${accessToken}` } });
  expect(res.status, "read the workspace").toBe(200);
  return ((await res.json()) as { retentionYears: number }).retentionYears;
}

const group = (page: Page) => page.getByRole("group", { name: "Click data retention" });
const choice = (page: Page, label: string) => group(page).getByRole("button", { name: label, exact: true });
const save = (page: Page) => page.getByRole("button", { name: "Save changes" });

test.describe("Journey — retention lowering confirm (#780)", () => {
  test("@mobile a shorter window asks first; cancel keeps the stored value, confirm stores it; a longer one does not ask", async ({ page }, info) => {
    mkdirSync(SHOTS, { recursive: true });
    const tag = info.project.name;
    const session = await registerUser(makeEmail("j780"));
    await seedAccount(page, session);

    await page.goto("/settings");
    await expect(choice(page, "3 years")).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });

    // 1. Lowering + Save -> a question, and nothing stored yet.
    await choice(page, "1 year").click();
    await save(page).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete click data older than 1 year?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("permanently deleted");
    await expect(dialog).toContainText("next maintenance pass");
    await page.screenshot({ path: path.join(SHOTS, `dialog-light-${tag}.png`) });
    expect(await savedRetention(session.accessToken), "nothing is stored while the question is open").toBe(3);

    // 2. Cancel -> the previous value is back and still stored.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(choice(page, "3 years")).toHaveAttribute("aria-pressed", "true");
    await expect(save(page)).toBeDisabled();
    expect(await savedRetention(session.accessToken)).toBe(3);

    // The same question in the dark theme (appearance is stored per device).
    await page.evaluate(() => window.localStorage.setItem("snapurl.appearance", JSON.stringify({ accent: "Cobalt", mode: "dark", density: "1", radius: "9px", reduceMotion: false })));
    await page.reload();
    await choice(page, "1 year").click();
    await save(page).click();
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `dialog-dark-${tag}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await savedRetention(session.accessToken)).toBe(3);

    // 3. Confirm -> stored, and a reload agrees.
    await choice(page, "1 year").click();
    await save(page).click();
    await dialog.getByRole("button", { name: "Delete older data and save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    expect(await savedRetention(session.accessToken)).toBe(1);
    await page.reload();
    await expect(choice(page, "1 year")).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });

    // 4. A longer window keeps all data: no question.
    await choice(page, "3 years").click();
    await save(page).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await savedRetention(session.accessToken)).toBe(3);

    // 5. Forever is the longest window, so leaving it asks.
    await choice(page, "Forever").click();
    await save(page).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    expect(await savedRetention(session.accessToken)).toBe(100);
    await choice(page, "1 year").click();
    await save(page).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(choice(page, "Forever")).toHaveAttribute("aria-pressed", "true");
    expect(await savedRetention(session.accessToken)).toBe(100);
  });
});
