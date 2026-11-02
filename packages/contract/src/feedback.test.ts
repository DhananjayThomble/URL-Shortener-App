import { describe, expect, it } from "vitest";
import {
  FeedbackDetail,
  FeedbackListQuery,
  FeedbackPage,
  FeedbackRow,
  FeedbackStatus,
  SCREENSHOT_MAX_CHARS,
  ScreenshotDataUrl,
  SubmitFeedbackInput,
  SubmitFeedbackResult,
  UpdateFeedbackInput,
} from "./feedback.js";

/* #997 — the in-app "Report a problem" wire format. The public intake is
   reachable by signed-out visitors, so the body shape is the only guard on what
   gets stored; these tests pin every field, bound, enum value and the
   screenshot regex so a mutant that loosens any of them reds.

   All tests import {describe,expect,it} from vitest explicitly — globals are
   not enabled in this package. */

const PNG_PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("ScreenshotDataUrl", () => {
  it("accepts a png, jpeg and webp base64 data URL", () => {
    expect(ScreenshotDataUrl.safeParse(PNG_PX).success).toBe(true);
    expect(ScreenshotDataUrl.safeParse("data:image/jpeg;base64,AAAA").success).toBe(true);
    expect(ScreenshotDataUrl.safeParse("data:image/webp;base64,AAAA").success).toBe(true);
    // base64 may end with padding or not
    expect(ScreenshotDataUrl.safeParse("data:image/png;base64,QUJD").success).toBe(true);
    expect(ScreenshotDataUrl.safeParse("data:image/png;base64,QUJD==").success).toBe(true);
  });

  it("rejects a non-image or non-data-URL string", () => {
    expect(ScreenshotDataUrl.safeParse("https://example.com/x.png").success).toBe(false);
    expect(ScreenshotDataUrl.safeParse("data:image/gif;base64,AAAA").success).toBe(false);
    expect(ScreenshotDataUrl.safeParse("data:image/jpg;base64,AAAA").success).toBe(false); // jpg != jpeg
    expect(ScreenshotDataUrl.safeParse("data:text/plain;base64,AAAA").success).toBe(false);
    expect(ScreenshotDataUrl.safeParse("data:image/png,AAAA").success).toBe(false); // not base64
    expect(ScreenshotDataUrl.safeParse("AAAA").success).toBe(false);
    expect(ScreenshotDataUrl.safeParse("").success).toBe(false);
  });

  /* Pin the regex boundaries so a mutant that drops an anchor, loosens the
     char class, or widens the scheme alternation is caught (not just "a valid
     one passes, an obviously-wrong one fails"). */
  it("anchors the pattern at the start — leading junk is rejected", () => {
    // ^ dropped would let a prefix through.
    expect(ScreenshotDataUrl.safeParse("xdata:image/png;base64,AAAA").success).toBe(false);
    expect(ScreenshotDataUrl.safeParse(" data:image/png;base64,AAAA").success).toBe(false);
  });

  it("anchors the pattern at the end — trailing junk is rejected", () => {
    // $ dropped would let a suffix through.
    expect(ScreenshotDataUrl.safeParse("data:image/png;base64,AAAA<script>").success).toBe(false);
    expect(ScreenshotDataUrl.safeParse("data:image/png;base64,AA AA").success).toBe(false); // space not in base64 class
  });

  it("requires the exact ;base64, marker", () => {
    expect(ScreenshotDataUrl.safeParse("data:image/png;base32,AAAA").success).toBe(false);
    expect(ScreenshotDataUrl.safeParse("data:image/pngbase64,AAAA").success).toBe(false);
  });

  it("requires a non-empty base64 payload", () => {
    // the char class is one-or-more: an empty payload must fail.
    expect(ScreenshotDataUrl.safeParse("data:image/png;base64,").success).toBe(false);
    expect(ScreenshotDataUrl.safeParse("data:image/png;base64,==").success).toBe(false);
  });

  it("rejects a data URL over the size cap but accepts one at the cap", () => {
    const head = "data:image/png;base64,";
    const atCap = head + "A".repeat(SCREENSHOT_MAX_CHARS - head.length);
    expect(atCap.length).toBe(SCREENSHOT_MAX_CHARS);
    expect(ScreenshotDataUrl.safeParse(atCap).success).toBe(true);
    const overCap = head + "A".repeat(SCREENSHOT_MAX_CHARS - head.length + 1);
    expect(overCap.length).toBe(SCREENSHOT_MAX_CHARS + 1);
    expect(ScreenshotDataUrl.safeParse(overCap).success).toBe(false);
  });

  it("pins the cap constant", () => {
    expect(SCREENSHOT_MAX_CHARS).toBe(1_400_000);
  });
});

describe("SubmitFeedbackInput", () => {
  it("accepts a bare message (signed-out, no context)", () => {
    const parsed = SubmitFeedbackInput.parse({ message: "The share button does nothing." });
    expect(parsed.message).toBe("The share button does nothing.");
    expect(parsed.page).toBeUndefined();
  });

  it("trims the message and floors it at 3 non-space chars", () => {
    expect(SubmitFeedbackInput.safeParse({ message: "" }).success).toBe(false);
    expect(SubmitFeedbackInput.safeParse({ message: "  " }).success).toBe(false);
    expect(SubmitFeedbackInput.safeParse({ message: "ab" }).success).toBe(false);
    // trims surrounding whitespace
    expect(SubmitFeedbackInput.parse({ message: "  hello  " }).message).toBe("hello");
  });

  it("caps the message at 4000 chars", () => {
    expect(SubmitFeedbackInput.safeParse({ message: "x".repeat(4000) }).success).toBe(true);
    expect(SubmitFeedbackInput.safeParse({ message: "x".repeat(4001) }).success).toBe(false);
  });

  it("accepts and bounds the automatic context fields", () => {
    const ok = SubmitFeedbackInput.parse({
      message: "bug here",
      page: "/dashboard/links",
      appVersion: "2.1.7",
      errorEventId: "evt_abc123",
    });
    expect(ok.page).toBe("/dashboard/links");
    expect(ok.appVersion).toBe("2.1.7");
    expect(ok.errorEventId).toBe("evt_abc123");
    expect(SubmitFeedbackInput.safeParse({ message: "bug", page: "x".repeat(2049) }).success).toBe(false);
    expect(SubmitFeedbackInput.safeParse({ message: "bug", appVersion: "x".repeat(101) }).success).toBe(false);
    expect(SubmitFeedbackInput.safeParse({ message: "bug", errorEventId: "x".repeat(201) }).success).toBe(false);
  });

  it("validates reporterEmail as an email, allowing omitted or empty", () => {
    expect(SubmitFeedbackInput.safeParse({ message: "bug", reporterEmail: "me@example.com" }).success).toBe(true);
    expect(SubmitFeedbackInput.safeParse({ message: "bug", reporterEmail: "" }).success).toBe(true);
    expect(SubmitFeedbackInput.safeParse({ message: "bug" }).success).toBe(true);
    expect(SubmitFeedbackInput.safeParse({ message: "bug", reporterEmail: "not-an-email" }).success).toBe(false);
    expect(SubmitFeedbackInput.safeParse({ message: "bug", reporterEmail: "x".repeat(320) + "@e.com" }).success).toBe(
      false,
    );
  });

  it("accepts a valid screenshot and rejects a malformed one", () => {
    expect(SubmitFeedbackInput.safeParse({ message: "bug", screenshot: PNG_PX }).success).toBe(true);
    expect(SubmitFeedbackInput.safeParse({ message: "bug", screenshot: "not-a-data-url" }).success).toBe(false);
  });
});

describe("SubmitFeedbackResult", () => {
  it("requires ok boolean and id string (kills the shape → {} mutant)", () => {
    const parsed = SubmitFeedbackResult.parse({ ok: true, id: "f1" });
    expect(parsed.ok).toBe(true);
    expect(parsed.id).toBe("f1");
    expect(SubmitFeedbackResult.safeParse({ ok: "yes", id: "f1" }).success).toBe(false);
    expect(SubmitFeedbackResult.safeParse({ ok: true }).success).toBe(false);
    expect(SubmitFeedbackResult.safeParse({}).success).toBe(false);
  });
});

describe("FeedbackStatus enum", () => {
  it("accepts exactly its three values and rejects others", () => {
    for (const s of ["new", "in_progress", "done"]) {
      expect(FeedbackStatus.safeParse(s).success).toBe(true);
    }
    expect(FeedbackStatus.safeParse("open").success).toBe(false);
    expect(FeedbackStatus.safeParse("closed").success).toBe(false);
    expect(FeedbackStatus.safeParse("").success).toBe(false);
  });
});

describe("FeedbackListQuery", () => {
  it("defaults limit and offset when absent", () => {
    const parsed = FeedbackListQuery.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
    expect(parsed.status).toBeUndefined();
  });

  it("coerces string numbers and enforces bounds", () => {
    expect(FeedbackListQuery.parse({ limit: "10", offset: "5" }).limit).toBe(10);
    expect(FeedbackListQuery.parse({ limit: "10", offset: "5" }).offset).toBe(5);
    expect(FeedbackListQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(FeedbackListQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(FeedbackListQuery.safeParse({ offset: -1 }).success).toBe(false);
    expect(FeedbackListQuery.safeParse({ limit: 1.5 }).success).toBe(false);
  });

  it("validates the optional status filter against the enum", () => {
    expect(FeedbackListQuery.parse({ status: "done" }).status).toBe("done");
    expect(FeedbackListQuery.safeParse({ status: "nope" }).success).toBe(false);
  });
});

describe("UpdateFeedbackInput", () => {
  it("accepts a status change, a notes change, or both", () => {
    expect(UpdateFeedbackInput.safeParse({ status: "in_progress" }).success).toBe(true);
    expect(UpdateFeedbackInput.safeParse({ notes: "looking into it" }).success).toBe(true);
    expect(UpdateFeedbackInput.safeParse({ status: "done", notes: "fixed" }).success).toBe(true);
  });

  it("rejects an empty update with the refine's own message (kills the blank-options mutant)", () => {
    const res = UpdateFeedbackInput.safeParse({});
    expect(res.success).toBe(false);
    // Asserting the refine's custom message means blanking the refine options
    // object changes observable behaviour, so that mutant cannot survive.
    if (!res.success) {
      expect(res.error.issues[0]!.message).toBe("Nothing to update: pass a status, notes, or both.");
    }
  });

  it("validates status against the enum and bounds notes", () => {
    expect(UpdateFeedbackInput.safeParse({ status: "garbage" }).success).toBe(false);
    expect(UpdateFeedbackInput.parse({ status: "done" }).status).toBe("done");
    expect(UpdateFeedbackInput.safeParse({ notes: "x".repeat(4001) }).success).toBe(false);
    expect(UpdateFeedbackInput.safeParse({ notes: "x".repeat(4000) }).success).toBe(true);
  });
});

describe("FeedbackRow / FeedbackDetail / FeedbackPage shapes", () => {
  const validRow = {
    id: "f1",
    message: "bug",
    page: null,
    userAgent: null,
    appVersion: null,
    errorEventId: null,
    hasScreenshot: false,
    userId: null,
    workspaceId: null,
    workspaceName: null,
    reporterEmail: null,
    status: "new" as const,
    notes: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  it("accepts a well-formed row and keeps its fields", () => {
    const parsed = FeedbackRow.parse(validRow);
    expect(parsed.id).toBe("f1");
    expect(parsed.status).toBe("new"); // a {} shape would drop every key
    expect(parsed.hasScreenshot).toBe(false);
  });

  it("requires each field with its declared type (kills the shape → {} mutant)", () => {
    expect(FeedbackRow.safeParse({ ...validRow, status: "garbage" }).success).toBe(false);
    expect(FeedbackRow.safeParse({ ...validRow, id: 123 }).success).toBe(false);
    expect(FeedbackRow.safeParse({ ...validRow, hasScreenshot: "nope" }).success).toBe(false);
    const { id: _id, ...noId } = validRow;
    expect(FeedbackRow.safeParse(noId).success).toBe(false);
    // nullable strings are not free-form numbers
    expect(FeedbackRow.safeParse({ ...validRow, page: 5 }).success).toBe(false);
    expect(FeedbackRow.safeParse({ ...validRow, workspaceName: 5 }).success).toBe(false);
  });

  it("FeedbackDetail adds a nullable screenshot and keeps the base fields", () => {
    const withShot = FeedbackDetail.parse({ ...validRow, screenshot: PNG_PX });
    expect(withShot.screenshot).toBe(PNG_PX);
    expect(FeedbackDetail.parse({ ...validRow, screenshot: null }).screenshot).toBeNull();
    // the base-row fields are still required
    expect(FeedbackDetail.safeParse({ screenshot: null }).success).toBe(false);
  });

  it("FeedbackPage requires hasMore boolean and a rows array of FeedbackRow", () => {
    const page = FeedbackPage.parse({ hasMore: true, rows: [validRow] });
    expect(page.hasMore).toBe(true);
    expect(page.rows).toHaveLength(1);
    expect(FeedbackPage.safeParse({ hasMore: "yes", rows: [] }).success).toBe(false);
    expect(FeedbackPage.safeParse({ hasMore: false, rows: [{ ...validRow, status: "bad" }] }).success).toBe(false);
  });
});
