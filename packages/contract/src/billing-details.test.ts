import { describe, expect, it } from "vitest";
import {
  BillingAddress,
  BillingDetails,
  BillingDetailsInput,
  CountryCode,
  GSTIN_REGEX,
} from "./billing-details.js";

/* A structurally-valid GSTIN: 2 state digits, a 10-char PAN (AAAAA9999A), an
 * entity digit, 'Z', a checksum char. Obviously-fake but well-formed. */
const VALID_GSTIN = "29ABCDE1234F1Z5";

describe("GSTIN_REGEX", () => {
  it("accepts a well-formed 15-char GSTIN", () => {
    expect(GSTIN_REGEX.test(VALID_GSTIN)).toBe(true);
  });

  it("rejects a GSTIN of the wrong length or shape", () => {
    expect(GSTIN_REGEX.test("29ABCDE1234F1Z")).toBe(false); // 14 chars
    expect(GSTIN_REGEX.test("29ABCDE1234F1Z55")).toBe(false); // 16 chars
    expect(GSTIN_REGEX.test("ABCDE1234F1Z529")).toBe(false); // letters where digits go
    expect(GSTIN_REGEX.test("29ABCDE1234F1X5")).toBe(false); // the literal 'Z' slot is wrong
  });
});

describe("CountryCode", () => {
  it("upper-cases and accepts a two-letter code", () => {
    expect(CountryCode.parse("in")).toBe("IN");
    expect(CountryCode.parse(" us ")).toBe("US");
  });

  it("rejects anything that is not two letters", () => {
    expect(() => CountryCode.parse("India")).toThrow();
    expect(() => CountryCode.parse("I")).toThrow();
    expect(() => CountryCode.parse("12")).toThrow();
  });
});

describe("BillingAddress", () => {
  it("accepts a full address", () => {
    const a = BillingAddress.parse({
      line1: "1 MG Road",
      line2: "Suite 2",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "in",
    });
    expect(a.country).toBe("IN");
    expect(a.line1).toBe("1 MG Road");
  });

  it("accepts an empty address (all fields optional)", () => {
    expect(() => BillingAddress.parse({})).not.toThrow();
  });

  it("rejects an unknown key (strict)", () => {
    expect(() => BillingAddress.parse({ zip: "560001" })).toThrow();
  });

  it("rejects an over-long line", () => {
    expect(() => BillingAddress.parse({ line1: "x".repeat(201) })).toThrow();
  });
});

describe("BillingDetailsInput", () => {
  it("accepts an all-optional empty input", () => {
    expect(() => BillingDetailsInput.parse({})).not.toThrow();
  });

  it("accepts and upper-cases a tax id", () => {
    const v = BillingDetailsInput.parse({ taxId: "29abcde1234f1z5" });
    expect(v.taxId).toBe(VALID_GSTIN);
  });

  it("validates a billing email", () => {
    expect(() => BillingDetailsInput.parse({ billingEmail: "not-an-email" })).toThrow();
    const v = BillingDetailsInput.parse({ billingEmail: "accounts@example.com" });
    expect(v.billingEmail).toBe("accounts@example.com");
  });

  it("enforces the GSTIN shape when the country is India", () => {
    // India + a malformed tax id → rejected, blaming taxId.
    const bad = BillingDetailsInput.safeParse({ taxId: "NOTAGSTIN", address: { country: "IN" } });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]!.path).toEqual(["taxId"]);

    // India + a valid GSTIN → accepted.
    expect(() =>
      BillingDetailsInput.parse({ taxId: VALID_GSTIN, address: { country: "IN" } }),
    ).not.toThrow();
  });

  it("does NOT enforce the GSTIN shape for a non-India country", () => {
    // A US tax id (EIN-like) is a free string, not a GSTIN.
    expect(() =>
      BillingDetailsInput.parse({ taxId: "12-3456789", address: { country: "US" } }),
    ).not.toThrow();
  });

  it("does NOT enforce the GSTIN shape when no country is given", () => {
    expect(() => BillingDetailsInput.parse({ taxId: "ANYTHING-GOES" })).not.toThrow();
  });

  it("accepts an empty tax id in India without demanding a GSTIN", () => {
    // An India address but no tax id entered yet is fine — the shape rule only
    // fires on a NON-empty tax id.
    expect(() => BillingDetailsInput.parse({ taxId: "", address: { country: "IN" } })).not.toThrow();
    expect(() => BillingDetailsInput.parse({ address: { country: "IN" } })).not.toThrow();
  });

  it("allows null to clear a field", () => {
    const v = BillingDetailsInput.parse({ companyName: null, taxId: null, address: null });
    expect(v.companyName).toBeNull();
    expect(v.address).toBeNull();
  });

  it("rejects an unknown key (strict)", () => {
    expect(() => BillingDetailsInput.parse({ gstin: VALID_GSTIN })).toThrow();
  });

  it("rejects an over-long company name and tax id", () => {
    expect(() => BillingDetailsInput.parse({ companyName: "x".repeat(201) })).toThrow();
    expect(() => BillingDetailsInput.parse({ taxId: "x".repeat(41) })).toThrow();
  });
});

describe("BillingDetails (read shape)", () => {
  it("parses an all-null record", () => {
    const d = BillingDetails.parse({
      billingEmail: null,
      companyName: null,
      taxId: null,
      address: null,
      updatedAt: null,
    });
    expect(d.companyName).toBeNull();
    expect(d.updatedAt).toBeNull();
  });

  it("parses a populated record", () => {
    const d = BillingDetails.parse({
      billingEmail: "accounts@example.com",
      companyName: "Acme Pvt Ltd",
      taxId: VALID_GSTIN,
      address: {
        line1: "1 MG Road",
        line2: null,
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "IN",
      },
      updatedAt: "2026-11-02T00:00:00.000Z",
    });
    expect(d.taxId).toBe(VALID_GSTIN);
    expect(d.address?.city).toBe("Bengaluru");
  });
});
