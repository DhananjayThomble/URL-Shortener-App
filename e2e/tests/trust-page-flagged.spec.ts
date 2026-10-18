import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey (#647): a visitor follows a short link that an operator has
   flagged. The redirect service answers 302 -> /p/<slug>?warning=unsafe
   (apps/redirect/src/main.ts, `blocked === "flagged"`). The public trust page
   used to treat that exactly like an unscanned link ("We couldn't fully verify
   this link" / "Unverified" / a friendly blue "Continue to" button), so the
   visitor was never told the link was reported as dangerous.

   The public page needs no session. Fixtures mode serves /public/links/<slug>/preview
   from web/src/lib/api/fixtures.ts: /p/app is a "clean", unprotected link (seeded
   unsuffixed in the real-stack lane too), so the ?warning=unsafe param is the
   ONLY thing that can turn it red — which is exactly the signal the redirect
   sends. (Not spring-sale: that fixture has a password, so its trust page
   correctly offers no Continue link at all — see
   mocked-api/trust-page-locked.spec.ts.) Selectors are accessible names / roles only.
   The redirect service itself is not in this suite (needs the staging stack). */

const DEST = "https://apps.apple.com/acme/download"; // fixtures' (and seed-real's) app destination

test.describe("public trust page: flagged link", () => {
  test("a normal visit says the link is safe and has no warning", async ({ page }) => {
    await page.goto("/p/app");
    await expect(page.getByRole("heading", { name: "This link is safe to open" })).toBeVisible();
    await expect(page.getByText("No threats found")).toBeVisible();
    await expect(page.getByText("Flagged as unsafe")).toHaveCount(0);
    await expect(page.getByText(/flagged as potentially dangerous/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Continue to / })).toBeVisible();
    await expect(page.getByRole("link", { name: /Continue anyway/ })).toHaveCount(0);
  });

  test("arriving from the redirect with ?warning=unsafe shows the red flagged state", async ({ page }) => {
    await page.goto("/p/app?warning=unsafe");

    // Heading, status chip, and an alert explaining it — not the "unverified" copy.
    await expect(page.getByRole("heading", { name: "This link has been flagged as unsafe" })).toBeVisible();
    await expect(page.getByText("Flagged as unsafe", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /do not continue/i })).toBeVisible();

    // None of the safe / unverified wording survives.
    await expect(page.getByText("This link is safe to open")).toHaveCount(0);
    await expect(page.getByText("No threats found")).toHaveCount(0);
    await expect(page.getByText("Unverified", { exact: true })).toHaveCount(0);
    await expect(page.getByText("We couldn't fully verify this link")).toHaveCount(0);

    // The way forward is still there (visitors may choose to continue) but is worded as a risk.
    const cont = page.getByRole("link", { name: /^Continue anyway to / });
    await expect(cont).toBeVisible();
    await expect(cont).toHaveAttribute("href", DEST);
    await expect(page.getByRole("link", { name: /^Continue to / })).toHaveCount(0);

    // The red state is what the visitor sees: the status chip is not styled as "good".
    await expect(page.getByText("Flagged as unsafe", { exact: true })).toHaveClass(/text-bad/);
  });

  test("an unrecognised warning value never escalates or de-escalates the page", async ({ page }) => {
    await page.goto("/p/app?warning=banana");
    await expect(page.getByRole("heading", { name: "This link is safe to open" })).toBeVisible();
    await expect(page.getByText(/flagged as potentially dangerous/)).toHaveCount(0);
  });
});

test.describe("abuse reports page wording (#647)", () => {
  test("describes flagging as a warning page, not a hard block", async ({ page }) => {
    await seedSession(page);
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Abuse reports" })).toBeVisible();
    await expect(page.getByText(/puts a warning page in front of its redirect/)).toBeVisible();
    await expect(page.getByText(/visitors can still choose to continue/)).toBeVisible();
    await expect(page.getByText(/blocks its redirect immediately/)).toHaveCount(0);
  });
});
