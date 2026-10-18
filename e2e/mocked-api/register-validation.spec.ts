import { expect, test } from "@playwright/test";
import { mockApi, nestError } from "../support/mock-api";

/* #794 — /register used two validation styles on one form: the zod resolver's
   inline messages AND the browser's native bubble (the email input is
   type="email", and the form had no `noValidate`). "qa-user1@" is the QA
   reproduction: Chromium's native check rejects it BEFORE the submit event
   fires, so the inline "That doesn't look like an email address" message never
   rendered and the user saw a browser tooltip instead.

   The oracle is the inline message itself: with native validation in play it
   cannot appear for that input, because the submit handler never runs. The
   form's own `noValidate` is asserted too, but only as a second witness.
   Validation is entirely client-side, so the API mock only has to stay quiet:
   any POST /auth/register would be a failure (recorded in `calls`).
   Runs on desktop Chrome and Pixel 7 (playwright.mocked-api.config.ts). */

const EMAIL_MSG = "That doesn't look like an email address";
const PASSWORD_MSG = "Use at least 12 characters — length beats complexity";

async function openRegister(page: import("@playwright/test").Page) {
  const api = await mockApi(page, { "GET /auth/me": nestError(401, "Unauthorized") });
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Start free" })).toBeVisible();
  return api;
}

test.describe("register validation is inline only (#794)", () => {
  test("the form opts out of native browser validation", async ({ page }) => {
    await openRegister(page);
    const form = page.locator("form", { has: page.getByRole("button", { name: "Create account" }) });
    expect(await form.evaluate((f: HTMLFormElement) => f.noValidate)).toBe(true);
  });

  test("a malformed email (qa-user1@) shows the inline message, wired to the field", async ({ page }) => {
    const api = await openRegister(page);

    await page.getByLabel("Name").fill("QA User");
    const email = page.getByLabel("Email");
    await email.fill("qa-user1@");
    await page.getByLabel("Password").fill("a-long-enough-password");
    await page.getByRole("button", { name: "Create account" }).click();

    const message = page.getByText(EMAIL_MSG);
    await expect(message).toBeVisible();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    // The message is programmatically tied to the control it describes.
    const describedBy = await email.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(EMAIL_MSG);
    // Focus moves to the field that needs fixing.
    await expect(email).toBeFocused();

    await expect(page).toHaveURL(/\/register$/);
    expect(api.callsTo("POST", "/auth/register")).toHaveLength(0);
  });

  test("an empty submit explains every field inline and sends nothing", async ({ page }) => {
    const api = await openRegister(page);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("What should we call you?")).toBeVisible();
    await expect(page.getByText("Enter your email address")).toBeVisible();
    await expect(page.getByText(PASSWORD_MSG)).toBeVisible();
    await expect(page.getByLabel("Name")).toBeFocused();
    expect(api.callsTo("POST", "/auth/register")).toHaveLength(0);
  });

  test("Enter in a field validates inline too, and a whitespace-only name is rejected", async ({ page }) => {
    const api = await openRegister(page);
    await page.getByLabel("Name").fill("   ");
    await page.getByLabel("Email").fill("not an email");
    await page.getByLabel("Password").fill("short");
    await page.getByLabel("Password").press("Enter");

    await expect(page.getByText(EMAIL_MSG)).toBeVisible();
    await expect(page.getByText(PASSWORD_MSG)).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
    expect(api.callsTo("POST", "/auth/register")).toHaveLength(0);
  });

  test("fixing the email clears its message and lets the form submit", async ({ page }) => {
    const api = await openRegister(page);
    await page.getByLabel("Name").fill("QA User");
    await page.getByLabel("Email").fill("qa-user1@");
    await page.getByLabel("Password").fill("a-long-enough-password");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(EMAIL_MSG)).toBeVisible();

    await page.getByLabel("Email").fill("qa-user1@example.com");
    // Revalidates on change after the first submit: the message goes away.
    await expect(page.getByText(EMAIL_MSG)).toHaveCount(0);
    await page.getByRole("button", { name: "Create account" }).click();
    // The request is attempted (the mock has no handler, so the app shows its error).
    await expect.poll(() => api.callsTo("POST", "/auth/register").length).toBe(1);
  });
});
