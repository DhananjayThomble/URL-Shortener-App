import { describe, expect, it } from "vitest";
import { CreateLinkInput } from "@snapurl/contract";
import { CREATE_LINK_SAMPLE, snippets } from "./api-samples";

/* Issue #655: the /developers "Create a link" sample returned
   400 "rules.0.id: expected string" when copied as written. These tests run the
   sample through the same schema POST /links validates with, so it cannot
   drift from the contract again. */

const s = snippets("https://api.example.test/api/v1");

describe("developers page create-link sample", () => {
  it("the sample body satisfies CreateLinkInput", () => {
    const r = CreateLinkInput.safeParse(CREATE_LINK_SAMPLE);
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  });

  it("the JSON body inside the cURL snippet satisfies CreateLinkInput", () => {
    const m = /-d '([\s\S]*)'$/.exec(s.curl);
    expect(m).not.toBeNull();
    const r = CreateLinkInput.safeParse(JSON.parse(m![1]));
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  });

  it("every snippet gives its routing rule an id and none uses a fixed past expiry", () => {
    for (const body of Object.values(s)) {
      expect(body).toContain("rule_in");
      expect(body).not.toMatch(/2026-09-30|expires_?[aA]t/);
    }
  });

  it("uses a placeholder domain rather than one the reader does not own", () => {
    for (const body of Object.values(s)) {
      expect(body).toContain("<your-domain>");
      expect(body).not.toContain("snap.to");
    }
  });

  it("interpolates the API url into the cURL snippet", () => {
    expect(s.curl).toContain("https://api.example.test/api/v1/links");
  });
});
