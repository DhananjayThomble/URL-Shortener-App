import { describe, expect, it } from "vitest";
import {
  canChangeWorkspaceCurrency,
  currencyOptions,
  excludedLine,
  excludedNotice,
  formatMoney,
  WORKSPACE_CURRENCIES,
} from "./money";

/* #654 — G7 counts revenue only in the workspace currency and converts
   nothing. These helpers are what make that visible: money rendered in the
   workspace's own currency (not a hard-coded ₹), the "N conversions were not
   counted" sentence, and the Settings currency choices. */

describe("formatMoney", () => {
  it("keeps the existing Indian formatting for INR", () => {
    expect(formatMoney(1500, "INR")).toBe("₹1,500");
    expect(formatMoney(250_000, "INR")).toBe("₹2.5L");
  });

  it("renders other currencies with their own symbol, not ₹", () => {
    expect(formatMoney(49, "USD")).toBe("$49");
    expect(formatMoney(1234.5, "EUR")).toBe("€1,234.50");
    expect(formatMoney(10, "GBP")).toBe("£10");
  });

  it("treats the code case-insensitively", () => {
    expect(formatMoney(49, "usd")).toBe("$49");
    expect(formatMoney(1500, "inr")).toBe("₹1,500");
  });

  it("never throws on a code Intl does not know: it shows the code", () => {
    expect(formatMoney(49, "XX1")).toBe("XX1 49");
    expect(formatMoney(0, "ZZZ")).toMatch(/^ZZZ\s?0$/);
  });

  it("renders zero as a plain zero", () => {
    expect(formatMoney(0, "USD")).toBe("$0");
  });
});

describe("excludedNotice", () => {
  const none = { count: 0, byCurrency: [] };

  it("is null when nothing was excluded, so the page renders nothing", () => {
    expect(excludedNotice(none)).toBeNull();
  });

  it("names the count and the currencies (plural)", () => {
    expect(excludedNotice({ count: 2, byCurrency: [{ currency: "USD", count: 2, valueMinor: 5900 }] })).toBe(
      "2 conversions in other currencies (USD) were not counted in revenue.",
    );
  });

  it("is grammatical for exactly one", () => {
    expect(excludedNotice({ count: 1, byCurrency: [{ currency: "USD", count: 1, valueMinor: 4900 }] })).toBe(
      "1 conversion in another currency (USD) was not counted in revenue.",
    );
  });

  it("lists every currency, in the order the API sent them", () => {
    const text = excludedNotice({
      count: 3,
      byCurrency: [
        { currency: "USD", count: 2, valueMinor: 5900 },
        { currency: "EUR", count: 1, valueMinor: 2500 },
      ],
    });
    expect(text).toBe("3 conversions in other currencies (USD, EUR) were not counted in revenue.");
  });

  it("groups thousands", () => {
    expect(excludedNotice({ count: 1200, byCurrency: [{ currency: "USD", count: 1200, valueMinor: 1 }] })).toMatch(/^1,200 conversions/);
  });
});

describe("excludedLine", () => {
  it("shows currency, count and the value in that currency (minor -> major)", () => {
    expect(excludedLine({ currency: "USD", count: 2, valueMinor: 5900 })).toBe("USD · 2 conversions · $59");
    expect(excludedLine({ currency: "EUR", count: 1, valueMinor: 2550 })).toBe("EUR · 1 conversion · €25.50");
  });
});

describe("currencyOptions", () => {
  it("offers the common currencies, INR and USD among them", () => {
    expect(WORKSPACE_CURRENCIES).toContain("INR");
    expect(WORKSPACE_CURRENCIES).toContain("USD");
    expect(currencyOptions("INR").map((o) => o.value)).toEqual(expect.arrayContaining(["INR", "USD", "EUR", "GBP"]));
  });

  it("always includes the current currency, even one not in the list, so the select never shows a wrong value", () => {
    const options = currencyOptions("XOF");
    expect(options.map((o) => o.value)).toContain("XOF");
  });

  it("does not duplicate the current currency", () => {
    const values = currencyOptions("usd").map((o) => o.value);
    expect(values.filter((v) => v === "USD")).toHaveLength(1);
    expect(values).not.toContain("usd");
  });

  it("labels each option with its code", () => {
    expect(currencyOptions("INR").find((o) => o.value === "USD")?.label).toMatch(/^USD/);
  });

  it("only offers two-decimal currencies, because the API divides minor units by 100", () => {
    expect(WORKSPACE_CURRENCIES).not.toContain("JPY");
    expect(WORKSPACE_CURRENCIES).not.toContain("KRW");
  });
});

describe("canChangeWorkspaceCurrency", () => {
  /* Mirrors PATCH /workspaces/current: @Roles("admin"), i.e. admin or owner. */
  it("is true for owner and admin only", () => {
    expect(canChangeWorkspaceCurrency("owner")).toBe(true);
    expect(canChangeWorkspaceCurrency("admin")).toBe(true);
    expect(canChangeWorkspaceCurrency("editor")).toBe(false);
    expect(canChangeWorkspaceCurrency("viewer")).toBe(false);
  });

  it("is false while the role is still loading", () => {
    expect(canChangeWorkspaceCurrency(undefined)).toBe(false);
  });
});
