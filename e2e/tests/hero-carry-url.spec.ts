import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* Issue #660 — the marketing hero's Shorten box used to drop the pasted URL on
   the floor: it was a plain <Link href="/register">. These journeys prove the
   URL is now carried all the way into the create-link drawer, for both a
   signed-out visitor (via sign-up) and a signed-in one, and that a refresh does
   not reopen the drawer.

   Fixtures mode (no API/DB): POST /auth/register returns the fixture SESSION for
   any credentials, so the sign-up step really drives the register form and the
   client-side route guard, not a mock of them. Selectors are accessible names
   only (getByRole / getByLabel), per #352. */

const PASTED = "https://acme.com/collections/spring-2026?utm_source=instagram";

test.describe("hero Shorten box carries the URL (#660)", () => {
  test("signed-out: submit -> register -> lands on /links with the drawer prefilled", async ({ page }) => {
    await page.goto("/");

    // The hero box is a real form with an accessible input and a Shorten button.
    const url = page.getByLabel("URL to shorten");
    await url.fill(PASTED);
    await page.getByRole("button", { name: "Shorten" }).click();

    // A signed-out visitor is sent to sign up, carrying the drawer deep link as
    // `next` — the pasted URL survives the encode.
    await expect(page).toHaveURL(/\/register\?next=/);
    const next = new URL(page.url()).searchParams.get("next")!;
    expect(new URL(next, "https://x.invalid").searchParams.get("new")).toBe(PASTED);

    // Complete sign-up. Fixtures accept any credentials and return a session.
    await page.getByLabel("Name").fill("Priya Raman");
    await page.getByLabel("Email").fill("priya@example.com");
    await page.getByLabel("Password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Create account" }).click();

    // Lands on /links, drawer open, Destination prefilled with the pasted URL.
    await expect(page).toHaveURL(/\/links(\?|$)/);
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel("Destination URL")).toHaveValue(PASTED);
  });

  test("signed-in: submit -> straight to the drawer, prefilled", async ({ page }) => {
    await seedSession(page);
    await page.goto("/");

    await page.getByLabel("URL to shorten").fill(PASTED);
    await page.getByRole("button", { name: "Shorten" }).click();

    await expect(page).toHaveURL(/\/links(\?|$)/);
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel("Destination URL")).toHaveValue(PASTED);
  });

  test("the ?new= param is dropped so a refresh does not reopen the drawer", async ({ page }) => {
    await seedSession(page);
    await page.goto("/");
    await page.getByLabel("URL to shorten").fill(PASTED);
    await page.getByRole("button", { name: "Shorten" }).click();

    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();
    // router.replace dropped the param: the URL is a bare /links.
    await expect(page).toHaveURL(/\/links$/);

    // A full reload must land on a plain /links with no drawer.
    await page.reload();
    await expect(page).toHaveURL(/\/links$/);
    await expect(page.getByRole("dialog", { name: "Create a link" })).toBeHidden();
  });

  test("an invalid URL shows an accessible inline error and does not navigate", async ({ page }) => {
    await page.goto("/");
    const url = page.getByLabel("URL to shorten");
    await url.fill("not a url");
    await page.getByRole("button", { name: "Shorten" }).click();

    // Still on the landing page; an inline error is announced and wired to the
    // input. Scope to the hero's own alert — Next's route announcer also has
    // role="alert" but is empty.
    await expect(page).toHaveURL(/\/$/);
    const alert = page.getByRole("alert").filter({ hasText: /http/i });
    await expect(alert).toBeVisible();
    await expect(url).toHaveAttribute("aria-invalid", "true");

    // Fixing the input and resubmitting clears the error and navigates.
    await url.fill(PASTED);
    await page.getByRole("button", { name: "Shorten" }).click();
    await expect(page).toHaveURL(/\/register\?next=/);
  });

  test("the demo card is labelled Example so it is not mistaken for a real result", async ({ page }) => {
    await page.goto("/");
    const example = page.getByText("Example", { exact: true });
    await expect(example).toBeVisible();
  });
});
