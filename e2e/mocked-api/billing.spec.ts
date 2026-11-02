import { expect, test, type Page } from "@playwright/test";
import {
  MOCK_USER,
  MOCK_WORKSPACE,
  mockApi,
  nestError,
  seedMockSession,
  type MockReply,
} from "../support/mock-api";

/* ============================================================
   E2E (#988) — Settings → Billing: upgrade, cancel, and the billing-off state.

   The REAL API client runs against browser-level answers (support/mock-api.ts),
   so the billing hooks' 404→BILLING_OFF handling, the owner-only gate and the
   Razorpay checkout hand-off are all the real code. Three acceptance oracles
   from the issue:

   1. BILLING OFF — the default. GET /billing/subscription 404s, so the Billing
      card is not rendered at all, and the "everything is free" note stays.
   2. UPGRADE — billing on, workspace on Free. Clicking a plan's Upgrade fires
      POST /billing/checkout for that plan+interval and opens Razorpay Checkout
      (window.Razorpay is stubbed) with the returned subscription id. The plan
      does not flip in the UI (only the webhook moves it) — the browser side is
      the checkout hand-off, which is what we assert.
   3. CANCEL — billing on, workspace on an active paid plan. Confirm-and-cancel
      fires POST /billing/cancel and the status flips to "Cancels at period end"
      on the re-read (the mock reflects the pending cancellation).

   Plus: OWNER-ONLY — a non-owner (admin) never sees the Billing card; and
   INVOICES — a paid workspace shows its invoices with a working Download link.

   Everything a control does is asserted by its OBSERVABLE EFFECT (a specific
   API call with the right body, a status chip changing, a link href), never by
   "the page rendered".
   ============================================================ */

const FREE_SUB = {
  planKey: "free",
  interval: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};
const ACTIVE_PRO = {
  planKey: "pro",
  interval: "monthly",
  status: "active",
  currentPeriodEnd: "2026-12-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
};
const INVOICES = [
  {
    id: "inv_1",
    number: "INV-0001",
    status: "paid",
    amount: 99900,
    currency: "INR",
    createdAt: "2026-11-01T00:00:00.000Z",
    pdfUrl: "https://rzp.example/invoices/inv_1.pdf",
  },
];

/** Stub window.Razorpay BEFORE the app boots, recording what Checkout was
 *  opened with. No real Razorpay is loaded (the helper resolves immediately
 *  when window.Razorpay is already set). */
async function stubRazorpay(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      Razorpay?: unknown;
      __rzpOpened?: Array<Record<string, unknown>>;
    };
    w.__rzpOpened = [];
    w.Razorpay = class {
      private readonly opts: Record<string, unknown>;
      constructor(opts: Record<string, unknown>) {
        this.opts = opts;
      }
      open() {
        w.__rzpOpened!.push(this.opts);
      }
    };
  });
}

type Role = "owner" | "admin";

async function openSettings(
  page: Page,
  opts: { role?: Role; subscription?: unknown | "off"; invoices?: unknown[] | "off" } = {},
) {
  const role = opts.role ?? "owner";
  const subReply: MockReply =
    opts.subscription === "off" || opts.subscription === undefined
      ? nestError(404, "Billing is disabled on this deployment.", "Not Found")
      : { status: 200, body: opts.subscription };
  const invReply: MockReply =
    opts.invoices === "off" || opts.invoices === undefined
      ? nestError(404, "Billing is disabled on this deployment.", "Not Found")
      : { status: 200, body: opts.invoices };

  await seedMockSession(page);
  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: { ...MOCK_USER, role, plan: "Free" } },
    "GET /workspaces/current": { status: 200, body: { ...MOCK_WORKSPACE, plan: "Free" } },
    "GET /domains": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
    "GET /billing/subscription": subReply,
    "GET /billing/invoices": invReply,
  });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  return api;
}

const billingCard = (page: Page) =>
  page.getByRole("heading", { name: "Billing", exact: true });

test.describe("Settings > Billing (#988)", () => {
  test("billing OFF: no Billing card, and the free note stays", async ({ page }) => {
    await openSettings(page, { subscription: "off" });
    await expect(billingCard(page)).toHaveCount(0);
    // The original "everything is free / nothing to manage" note is still shown.
    await expect(page.getByText(/no billing to manage/i)).toBeVisible();
  });

  test("owner-only: an admin (non-owner) never sees the Billing card", async ({ page }) => {
    // Even with billing ON, a non-owner must not see or ask for billing.
    const api = await openSettings(page, { role: "admin", subscription: ACTIVE_PRO, invoices: INVOICES });
    await expect(billingCard(page)).toHaveCount(0);
    // And the owner-only queries were never made for a non-owner.
    await page.waitForTimeout(300);
    expect(api.callsTo("GET", "/billing/subscription")).toHaveLength(0);
    expect(api.callsTo("GET", "/billing/invoices")).toHaveLength(0);
  });

  test("upgrade from Free: clicking Upgrade starts a checkout and opens Razorpay", async ({ page }) => {
    await stubRazorpay(page);
    await seedMockSession(page);
    // The checkout handler lives in mockApi so the POST is RECORDED in
    // api.calls (a separate page.route would bypass the catch-all recorder).
    const api = await mockApi(page, {
      "GET /auth/me": { status: 200, body: { ...MOCK_USER, role: "owner", plan: "Free" } },
      "GET /workspaces/current": { status: 200, body: { ...MOCK_WORKSPACE, plan: "Free" } },
      "GET /domains": { status: 200, body: [] },
      "GET /members": { status: 200, body: [] },
      "GET /billing/subscription": { status: 200, body: FREE_SUB },
      "GET /billing/invoices": { status: 200, body: [] },
      "POST /billing/checkout": {
        status: 200,
        body: {
          provider: "razorpay",
          subscriptionId: "sub_e2e_pro",
          keyId: "rzp_test_e2e",
          planKey: "pro",
          interval: "yearly",
          // #987 added these to CheckoutSession (live price at checkout time).
          amountMinor: 199900,
          currency: "INR",
        },
      },
    });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    await expect(billingCard(page)).toBeVisible();
    await expect(page.getByTestId("billing-current-plan")).toHaveText(/Free/);

    // Pick the yearly interval, then upgrade to Pro. Segmented renders its
    // options as aria-pressed buttons inside a role="group", so select the
    // button within the "Billing interval" group.
    const intervalGroup = page.getByRole("group", { name: "Billing interval" });
    await intervalGroup.getByRole("button", { name: "Yearly" }).click();
    await expect(intervalGroup.getByRole("button", { name: "Yearly" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Upgrade to Pro" }).click();

    // The checkout POST fired with the chosen plan + interval…
    await expect
      .poll(() => api.callsTo("POST", "/billing/checkout").length)
      .toBeGreaterThan(0);
    const checkoutBody = api.callsTo("POST", "/billing/checkout")[0]!.body as {
      planKey: string;
      interval: string;
    };
    expect(checkoutBody).toEqual({ planKey: "pro", interval: "yearly" });

    // …and Razorpay Checkout was opened with the returned subscription id.
    // openRazorpayCheckout runs AFTER the checkout POST resolves, so poll for
    // the recorded open() rather than reading once (a single read races the
    // async hand-off and is empty under slower CI).
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __rzpOpened?: Array<Record<string, unknown>> }).__rzpOpened?.length ?? 0,
        ),
      )
      .toBe(1);
    const opened = await page.evaluate(
      () => (window as unknown as { __rzpOpened?: Array<Record<string, unknown>> }).__rzpOpened ?? [],
    );
    expect(opened[0]!.subscription_id).toBe("sub_e2e_pro");
    expect(opened[0]!.key).toBe("rzp_test_e2e");
  });

  test("cancel: confirm-and-cancel fires POST /billing/cancel and the status flips to pending", async ({ page }) => {
    await seedMockSession(page);
    // Stateful subscription: active until cancel is posted, then reflects the
    // pending cancellation on the next read.
    let cancelled = false;
    const api = await mockApi(page, {
      "GET /auth/me": { status: 200, body: { ...MOCK_USER, role: "owner", plan: "Pro" } },
      "GET /workspaces/current": { status: 200, body: { ...MOCK_WORKSPACE, plan: "Pro" } },
      "GET /domains": { status: 200, body: [] },
      "GET /members": { status: 200, body: [] },
      "GET /billing/invoices": { status: 200, body: INVOICES },
      "GET /billing/subscription": () => ({
        status: 200,
        body: cancelled ? { ...ACTIVE_PRO, cancelAtPeriodEnd: true } : ACTIVE_PRO,
      }),
      "POST /billing/cancel": () => {
        cancelled = true;
        return { status: 200, body: { ...ACTIVE_PRO, cancelAtPeriodEnd: true } };
      },
    });
    await page.goto("/settings");
    await expect(billingCard(page)).toBeVisible();
    await expect(page.getByTestId("billing-current-plan")).toHaveText(/Pro/);

    // Open the cancel confirm, then confirm.
    await page.getByRole("button", { name: "Cancel subscription" }).click();
    await page.getByRole("button", { name: "Cancel at period end" }).click();

    await expect.poll(() => api.callsTo("POST", "/billing/cancel").length).toBeGreaterThan(0);
    // The status chip reflects the pending cancellation after the re-read.
    await expect(page.getByText("Cancels at period end")).toBeVisible();
  });

  test("change plan: a paid workspace changes to Team via POST /billing/change", async ({ page }) => {
    await seedMockSession(page);
    const api = await mockApi(page, {
      "GET /auth/me": { status: 200, body: { ...MOCK_USER, role: "owner", plan: "Pro" } },
      "GET /workspaces/current": { status: 200, body: { ...MOCK_WORKSPACE, plan: "Pro" } },
      "GET /domains": { status: 200, body: [] },
      "GET /members": { status: 200, body: [] },
      "GET /billing/invoices": { status: 200, body: INVOICES },
      "GET /billing/subscription": { status: 200, body: ACTIVE_PRO },
      "POST /billing/change": { status: 200, body: { ...ACTIVE_PRO, planKey: "team" } },
    });
    await page.goto("/settings");
    await expect(billingCard(page)).toBeVisible();

    // On a paid plan the current plan is marked "Current" and others offer Change.
    await page.getByRole("button", { name: "Change to Team" }).click();

    await expect.poll(() => api.callsTo("POST", "/billing/change").length).toBeGreaterThan(0);
    expect(api.callsTo("POST", "/billing/change")[0]!.body).toEqual({ planKey: "team", interval: "monthly" });
  });

  test("invoices: a paid workspace shows its invoices with a working Download link", async ({ page }) => {
    await openSettings(page, { subscription: ACTIVE_PRO, invoices: INVOICES });
    await expect(billingCard(page)).toBeVisible();

    const invoiceList = page.getByTestId("billing-invoices");
    await expect(invoiceList).toBeVisible();
    const download = invoiceList.getByRole("link", { name: /download invoice/i });
    await expect(download).toHaveAttribute("href", "https://rzp.example/invoices/inv_1.pdf");
    await expect(download).toHaveAttribute("target", "_blank");
  });
});
