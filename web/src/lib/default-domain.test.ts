import { describe, expect, it } from "vitest";
import type { Domain } from "@snapurl/contract";
import { defaultDomainOptions, problemField } from "./default-domain";

const d = (domain: string, status: Domain["status"] = "live"): Domain => ({
  id: `id-${domain}`,
  domain,
  status,
  ssl: status === "live" ? "active" : "pending",
  links: 0,
  rootRedirect: null,
  notFoundRedirect: null,
});

describe("defaultDomainOptions (#779 — the Default domain select offers only valid domains)", () => {
  it("offers every live domain, and nothing else, in list order", () => {
    const list = [d("a.example"), d("p.example", "verifying"), d("f.example", "failed"), d("snap.example")];
    const opts = defaultDomainOptions(list, "snap.example");
    expect(opts.map((o) => o.value)).toEqual(["a.example", "snap.example"]);
    expect(opts.every((o) => !o.disabled)).toBe(true);
  });

  it("keeps the current default selectable-as-shown even when it is no longer live, marked as such", () => {
    const list = [d("a.example", "failed"), d("snap.example")];
    const opts = defaultDomainOptions(list, "a.example");
    expect(opts.map((o) => o.value)).toEqual(["a.example", "snap.example"]);
    const stale = opts.find((o) => o.value === "a.example")!;
    expect(stale.disabled).toBe(true);
    expect(stale.label).toMatch(/verification failed/);
  });

  it("matches the current default case-insensitively (no duplicate option)", () => {
    const opts = defaultDomainOptions([d("A.Example"), d("snap.example")], "a.EXAMPLE");
    expect(opts.map((o) => o.value)).toEqual(["A.Example", "snap.example"]);
  });

  it("a current default that is not in the list at all is still shown, disabled", () => {
    const opts = defaultDomainOptions([d("snap.example")], "gone.example");
    expect(opts[0]).toMatchObject({ value: "gone.example", disabled: true });
  });

  it("a workspace with no default gets a disabled 'Choose a domain' placeholder first", () => {
    const opts = defaultDomainOptions([d("snap.example")], "");
    expect(opts[0]).toMatchObject({ value: "", label: "Choose a domain", disabled: true });
    expect(opts.map((o) => o.value)).toEqual(["", "snap.example"]);
  });

  it("before the list loads there is only the current value to show", () => {
    expect(defaultDomainOptions(undefined, "snap.example").map((o) => o.value)).toEqual(["snap.example"]);
    expect(defaultDomainOptions(undefined, "")).toEqual([{ value: "", label: "Choose a domain", disabled: true }]);
  });
});

describe("problemField (#779 — a refused save is shown under the control it is about)", () => {
  const none = { defaultDomain: false, currency: false };

  it("only the domain changed -> the domain field", () => {
    expect(problemField("anything", { ...none, defaultDomain: true })).toBe("defaultDomain");
  });

  it("only the currency changed -> the currency field", () => {
    expect(problemField("Only owners and admins can change this.", { ...none, currency: true })).toBe("currency");
  });

  it("both changed: a message about a domain goes under the domain, anything else under the currency", () => {
    const both = { defaultDomain: true, currency: true };
    expect(problemField("not-mine.example isn't a domain in this workspace.", both)).toBe("defaultDomain");
    expect(problemField("a.example isn't verified yet, so links on it wouldn't resolve.", both)).toBe("defaultDomain");
    expect(problemField("Choose a default domain.", both)).toBe("defaultDomain");
    expect(problemField("currency: Invalid option", both)).toBe("currency");
  });

  it("neither changed -> the redirect-type field, where it has always been shown", () => {
    expect(problemField("Something broke.", none)).toBe("other");
  });
});
