import { describe, expect, it } from "vitest";
import { parseRedirectDraft } from "./domain-redirects";

/* Oracle: packages/contract UpdateDomainInput (HttpUrl for both fields, null
   clears) — #648. */
describe("parseRedirectDraft", () => {
  it("sends both URLs, trimmed", () => {
    expect(parseRedirectDraft("  https://example.org/  ", "https://example.org/404")).toEqual({
      ok: true,
      input: { rootRedirect: "https://example.org/", notFoundRedirect: "https://example.org/404" },
    });
  });

  it("a blank field is sent as null, which clears it", () => {
    expect(parseRedirectDraft("", "   ")).toEqual({ ok: true, input: { rootRedirect: null, notFoundRedirect: null } });
  });

  it("puts each validation message under its own field", () => {
    const r = parseRedirectDraft("javascript:alert(1)", "http://169.254.169.254/");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.rootRedirect).toBeTruthy();
    expect(r.errors.notFoundRedirect).toMatch(/isn't allowed/);
    expect(r.errors.form).toBeUndefined();
  });

  it("only flags the field that is wrong", () => {
    const r = parseRedirectDraft("https://example.org/", "not a url");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.rootRedirect).toBeUndefined();
    expect(r.errors.notFoundRedirect).toBeTruthy();
  });

  it.each(["data:text/html,hi", "file:///etc/passwd", "http://localhost/", "http://10.1.2.3/", "/relative"])(
    "rejects %s",
    (bad) => {
      expect(parseRedirectDraft(bad, "").ok).toBe(false);
    },
  );
});
