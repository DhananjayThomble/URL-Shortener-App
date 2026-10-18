import { describe, expect, it } from "vitest";
import { ApiError } from "./api/client";
import { detailLoadErrorKind } from "./load-error";

/* #790: the link detail page rendered every load failure as "That didn't load"
   + a "Try again" button. For a link that is not there (or is in another
   workspace, which the API deliberately reports identically) retrying can only
   repeat the same answer, so the page needs to tell the two apart. */
describe("detailLoadErrorKind", () => {
  it("a 404 is not-found: the link does not exist or is not in this workspace", () => {
    expect(detailLoadErrorKind(new ApiError(404, "That link doesn't exist, or isn't in this workspace."))).toBe("not-found");
  });

  it("a malformed id (400 from ParseUUIDPipe on GET /links/:id) is not-found, not a retryable failure", () => {
    expect(detailLoadErrorKind(new ApiError(400, "Validation failed (uuid is expected)"))).toBe("not-found");
  });

  it("a 403 is forbidden: retrying cannot grant permission", () => {
    expect(detailLoadErrorKind(new ApiError(403, "You don't have permission to do that."))).toBe("forbidden");
  });

  it.each([500, 502, 503, 429])("a %i is worth retrying", (status) => {
    expect(detailLoadErrorKind(new ApiError(status, "x"))).toBe("retry");
  });

  it("a network failure (plain Error / TypeError, no status) is worth retrying", () => {
    expect(detailLoadErrorKind(new TypeError("Failed to fetch"))).toBe("retry");
    expect(detailLoadErrorKind(new Error("boom"))).toBe("retry");
  });

  it("anything that is not an Error is worth retrying rather than crashing", () => {
    expect(detailLoadErrorKind(undefined)).toBe("retry");
    expect(detailLoadErrorKind(null)).toBe("retry");
    expect(detailLoadErrorKind("404")).toBe("retry");
    expect(detailLoadErrorKind({ status: 404 })).toBe("retry");
  });
});
