import { describe, expect, it } from "vitest";

import { buildUtm } from "./utm.js";

/*
 * UTM builder unit tests. The builder maps the popup's four form fields to the
 * `utm` object CreateLinkInput accepts, trimming and dropping empties.
 */

describe("buildUtm", () => {
  it("returns undefined when every field is empty", () => {
    expect(buildUtm({})).toBeUndefined();
    expect(buildUtm({ source: "", medium: "   ", campaign: undefined })).toBeUndefined();
  });

  it("includes only the non-empty, trimmed fields", () => {
    expect(buildUtm({ source: "  news ", medium: "email", campaign: "", content: "  " })).toEqual({
      source: "news",
      medium: "email",
    });
  });

  it("maps all four fields when present", () => {
    expect(buildUtm({ source: "s", medium: "m", campaign: "c", content: "x" })).toEqual({
      source: "s",
      medium: "m",
      campaign: "c",
      content: "x",
    });
  });
});
