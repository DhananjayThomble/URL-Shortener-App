import { describe, expect, it } from "vitest";
import type { WorkspaceSubscription } from "@snapurl/contract";
import { invoiceAmount, invoiceStatusLabel, isPaid, planLabel, statusView } from "./billing";

/* #988 — the Settings → Billing view helpers. */

const free: WorkspaceSubscription = {
  planKey: "free",
  interval: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  notice: null,
};
const activePro: WorkspaceSubscription = {
  planKey: "pro",
  interval: "monthly",
  status: "active",
  currentPeriodEnd: "2026-12-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  notice: null,
};

describe("planLabel", () => {
  it("title-cases the plan key", () => {
    expect(planLabel("free")).toBe("Free");
    expect(planLabel("pro")).toBe("Pro");
    expect(planLabel("team")).toBe("Team");
  });
});

describe("isPaid", () => {
  it("is true only for a paid key in an entitled status", () => {
    expect(isPaid(activePro)).toBe(true);
    expect(isPaid({ ...activePro, status: "trialing" })).toBe(true);
    expect(isPaid(free)).toBe(false);
    expect(isPaid({ ...activePro, status: "past_due" })).toBe(false);
    expect(isPaid({ ...activePro, status: "cancelled" })).toBe(false);
    // A free key never reads as paid even if it somehow carries an active status.
    expect(isPaid({ ...free, status: "active" })).toBe(false);
  });
});

describe("statusView", () => {
  it("shows 'Cancels at period end' with a warn tone when a cancellation is pending on a live plan", () => {
    const view = statusView({ ...activePro, cancelAtPeriodEnd: true });
    expect(view).toEqual({ label: "Cancels at period end", tone: "warn" });
  });

  it("does NOT show the pending-cancel label once the plan has already lapsed", () => {
    // cancelAtPeriodEnd true but the plan is no longer paid → show the lapsed status.
    const view = statusView({ ...activePro, status: "cancelled", cancelAtPeriodEnd: true });
    expect(view.label).toBe("Cancelled");
  });

  it("maps active/trialing to good/accent", () => {
    expect(statusView(activePro)).toEqual({ label: "Active", tone: "good" });
    expect(statusView({ ...activePro, status: "trialing" })).toEqual({ label: "Trial", tone: "accent" });
  });

  it("surfaces a failed charge honestly (not hidden)", () => {
    expect(statusView({ ...activePro, status: "past_due" }).tone).toBe("bad");
    expect(statusView({ ...activePro, status: "halted" }).label).toMatch(/payment failed/i);
  });

  it("falls back to 'Free plan' for the free shape", () => {
    expect(statusView(free)).toEqual({ label: "Free plan", tone: "default" });
  });
});

describe("invoiceAmount", () => {
  it("formats the minor-unit amount in its own currency (÷100)", () => {
    expect(invoiceAmount({ amount: 99900, currency: "INR" })).toContain("999");
    expect(invoiceAmount({ amount: 5000, currency: "USD" })).toBe("$50");
  });
});

describe("invoiceStatusLabel", () => {
  it("has a label for every status", () => {
    expect(invoiceStatusLabel("paid")).toBe("Paid");
    expect(invoiceStatusLabel("issued")).toBe("Issued");
    expect(invoiceStatusLabel("partially_paid")).toBe("Partially paid");
    expect(invoiceStatusLabel("cancelled")).toBe("Cancelled");
    expect(invoiceStatusLabel("expired")).toBe("Expired");
  });
});
