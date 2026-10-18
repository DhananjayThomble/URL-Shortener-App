import { describe, expect, it } from "vitest";
import { PREVIEWS_OFF_CODE, PREVIEWS_OFF_MESSAGE, isPreviewsOffRefusal } from "./public.js";

/* #765 — the 403 PublicService.preview sends when the owner turned public
   previews off. The page tells it from every other 403 by the response BODY:
   the client rewrites each 403's message to a generic string, so the body is
   all that survives. Matched positively, like the 2FA credential messages. */
describe("isPreviewsOffRefusal", () => {
  it("accepts the code (current API)", () => {
    expect(isPreviewsOffRefusal({ statusCode: 403, message: "anything", error: "Forbidden", code: PREVIEWS_OFF_CODE })).toBe(
      true,
    );
  });

  it("accepts the exact message without the code (an API from before the code existed)", () => {
    expect(isPreviewsOffRefusal({ statusCode: 403, message: PREVIEWS_OFF_MESSAGE, error: "Forbidden" })).toBe(true);
    expect(isPreviewsOffRefusal({ message: `  ${PREVIEWS_OFF_MESSAGE} ` })).toBe(true);
  });

  it("rejects every other body", () => {
    expect(isPreviewsOffRefusal({ statusCode: 403, message: "Forbidden resource", error: "Forbidden" })).toBe(false);
    expect(isPreviewsOffRefusal({ code: "other" })).toBe(false);
    expect(isPreviewsOffRefusal({ message: [PREVIEWS_OFF_MESSAGE] })).toBe(false);
    expect(isPreviewsOffRefusal({})).toBe(false);
    expect(isPreviewsOffRefusal("previews")).toBe(false);
    expect(isPreviewsOffRefusal(42)).toBe(false);
    expect(isPreviewsOffRefusal(null)).toBe(false);
    expect(isPreviewsOffRefusal(undefined)).toBe(false);
  });
});
