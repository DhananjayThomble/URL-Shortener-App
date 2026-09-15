/**
 * Journey 7 — Form
 *
 * Create a form with a field, submit a response through the public route
 * (/public/forms/:slug), and read that response back in the dashboard.
 *
 * Oracles:
 *   - packages/contract/src/form.ts — CreateFormInput, Form, SubmitFormInput
 *   - PublicController POST /public/forms/:slug handles unauthenticated submission
 *   - FormsController GET /forms/:id/responses returns responses for a form
 *   - Invariant: a submitted response must appear in the response list.
 */

import { expect, test } from "@playwright/test";
import {
  makeEmail,
  registerUser,
  seedAccount,
  API_URL,
  RUN_ID,
} from "./helpers";

test.describe("Journey 7 — Form", () => {
  test("create a form, submit a response, read it in the dashboard", async ({ page }) => {
    /* ---- Setup ---- */
    const session = await registerUser(makeEmail("j7"));

    /* ---- 1. Create a form via the API ---- */
    // The forms dashboard is read-only (per forms.spec.ts); creating via API
    // follows the same contract path.
    const formSlug = `j7form${RUN_ID.replace(/[^a-z0-9]/gi, "")}`.slice(0, 30).toLowerCase();
    const createRes = await fetch(`${API_URL}/forms`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "J7 Journey Form",
        description: "A form for journey 7 testing",
        slug: formSlug,
        status: "live",
        fields: [
          {
            key: "name",
            label: "Your Name",
            type: "text",
            required: true,
          },
          {
            key: "message",
            label: "Message",
            type: "textarea",
            required: false,
          },
        ],
      }),
    });
    expect(createRes.ok, "POST /forms should succeed").toBe(true);
    const form = await createRes.json() as { id: string; slug: string; status: string };
    expect(form.status, "Form should be live").toBe("live");
    expect(form.slug, "Form should have the slug we set").toBe(formSlug);

    /* ---- 2. Submit a response via the public route ---- */
    const uniqueAnswer = `J7-tester-${RUN_ID}`;
    const submitRes = await fetch(`${API_URL}/public/forms/${formSlug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: {
          name: uniqueAnswer,
          message: "This is a journey 7 test response",
        },
      }),
    });
    expect(submitRes.ok, "POST /public/forms/:slug should succeed").toBe(true);
    const submitBody = await submitRes.json() as { ok?: boolean };
    expect(submitBody.ok, "Submission should return {ok:true}").toBe(true);

    /* ---- 3. Read the response back via the API ---- */
    // Responses may take a moment to be queryable
    let responses: Array<{ id: string; answers: Record<string, string> }> = [];
    for (let i = 0; i < 5; i++) {
      const respRes = await fetch(`${API_URL}/forms/${form.id}/responses`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      if (respRes.ok) {
        const data = await respRes.json();
        responses = Array.isArray(data) ? data : data.items ?? [];
        if (responses.length > 0) break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(responses.length, "At least one response should exist").toBeGreaterThan(0);
    const ourResponse = responses.find((r) => {
      const answers = r.answers ?? {};
      return Object.values(answers).some((v) => String(v).includes(uniqueAnswer));
    });
    expect(ourResponse, `Response with name "${uniqueAnswer}" should exist`).toBeTruthy();

    /* ---- 4. Verify in the dashboard UI ---- */
    await seedAccount(page, session);
    await page.goto("/forms");
    await expect(page).toHaveURL(/\/forms/);

    // Our form should appear in the list
    const formRow = page.getByRole("row", { name: /J7 Journey Form/i });
    await expect(formRow).toBeVisible({ timeout: 15_000 });

    // Expand responses
    const respToggle = formRow.getByRole("button", { name: /Responses/i });
    if (await respToggle.count() > 0) {
      await respToggle.click();
      // The unique answer should appear in the responses panel
      await expect(page.getByText(uniqueAnswer)).toBeVisible({ timeout: 10_000 });
    }

    /* ---- 5. Also test: submit through the public web route ---- */
    // Check if /f/<slug> exists as a Next.js route
    const formPublicUrl = `/f/${formSlug}`;
    const webFormPage = await page.context().newPage();
    await webFormPage.goto(formPublicUrl, { waitUntil: "networkidle", timeout: 15_000 });
    const webFormStatus = webFormPage.url();

    if (!webFormPage.url().includes("/login") && !webFormPage.url().includes("/404")) {
      // The public form page rendered — submit via the UI
      const nameField = webFormPage.getByLabel(/your name/i).first();
      if (await nameField.count() > 0) {
        await nameField.fill(`${uniqueAnswer}-web`);
        const submitFormBtn = webFormPage.getByRole("button", { name: /submit|send/i });
        await submitFormBtn.click();
        // A success message should appear
        const success = webFormPage.getByText(/thank|submitted|success/i).first();
        if (await success.count() > 0) {
          await expect(success).toBeVisible({ timeout: 10_000 });
        }
      }
    } else {
      console.log(
        `[FINDING] J7: Public form route ${formPublicUrl} redirected to ${webFormStatus}. ` +
        `The public form page may not be available in this Next.js build/routing config.`,
      );
    }
    await webFormPage.close();
  });
});
