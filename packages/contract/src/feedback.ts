import { z } from "zod";

/* ============================================================
   In-app "Report a problem" feedback — #997.

   The wire format for the two-click problem reporter and its admin inbox. It
   lives here so the public web form, the API intake and the admin panel all
   validate the exact same shapes. This is distinct from report.ts, which is
   abuse reporting (#291) for malicious short links; this is product feedback.
   ============================================================ */

/* ---- public intake (signed-in or signed-out) ---- */

/* A screenshot, when offered, arrives as a data URL the browser produced from a
   canvas/File. It is OPTIONAL, bounded and validated server-side as well (see
   FeedbackService), but the shape is pinned here so an oversized or non-image
   payload is a clean 400 at the edge rather than a stored blob:
     - it must be a PNG, JPEG or WebP data URL (base64);
     - the whole string is capped so the inline blob cannot bloat the row or
       the request. ~1.4M chars of base64 ≈ ~1 MiB of image, a sane ceiling for
       a bug screenshot and far below any DB/body limit. */
export const SCREENSHOT_MAX_CHARS = 1_400_000;
export const ScreenshotDataUrl = z
  .string()
  .max(SCREENSHOT_MAX_CHARS, "That screenshot is too large — keep it under about 1 MB.")
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, "The screenshot must be a PNG, JPEG or WebP image.");

export const SubmitFeedbackInput = z.object({
  /* What is wrong. Non-trivial (a blank box tells the operator nothing) but no
     essay required; 3 is a floor that rejects "" and " ", 4000 the ceiling the
     feedback row stores. */
  message: z.string().trim().min(3, "Tell us what went wrong.").max(4000),

  /* Context the client captures automatically. All optional — a minimal client
     (or a signed-out visitor) may send only the message. Length-capped to match
     the stored columns; empty strings are treated as "not provided". */
  page: z.string().max(2048).optional(),
  appVersion: z.string().max(100).optional(),

  /* #997 point 4 — the error-tracking event id (#995), attached when present.
     Optional and validated as an opaque bounded string; no vendor SDK. */
  errorEventId: z.string().max(200).optional(),

  /* Optional contact so the operator can follow up with a signed-out reporter.
     Validated as an email when present; an empty string means "not provided".
     For a signed-in report the server fills this from the account instead. */
  reporterEmail: z.string().email().max(320).optional().or(z.literal("")),

  /* Optional, bounded, type-validated screenshot (see ScreenshotDataUrl). */
  screenshot: ScreenshotDataUrl.optional(),
});
export type SubmitFeedbackInput = z.infer<typeof SubmitFeedbackInput>;

/* The intake acknowledges with the created id so the client can show "sent".
   Unlike abuse reporting there is no enumeration concern here — feedback names
   no short link — so a straightforward ack is fine. */
export const SubmitFeedbackResult = z.object({ ok: z.boolean(), id: z.string() });
export type SubmitFeedbackResult = z.infer<typeof SubmitFeedbackResult>;

/* ---- admin inbox ---- */

export const FeedbackStatus = z.enum(["new", "in_progress", "done"]);
export type FeedbackStatus = z.infer<typeof FeedbackStatus>;

export const FeedbackRow = z.object({
  id: z.string(),
  message: z.string(),
  page: z.string().nullable(),
  userAgent: z.string().nullable(),
  appVersion: z.string().nullable(),
  errorEventId: z.string().nullable(),
  /* Whether a screenshot is attached — the inbox LIST never ships the blob
     itself (it would make the list response enormous); the detail route does. */
  hasScreenshot: z.boolean(),
  userId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  reporterEmail: z.string().nullable(),
  status: FeedbackStatus,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FeedbackRow = z.infer<typeof FeedbackRow>;

/* The detail view adds the screenshot data URL (null when none). */
export const FeedbackDetail = FeedbackRow.extend({
  screenshot: z.string().nullable(),
});
export type FeedbackDetail = z.infer<typeof FeedbackDetail>;

export const FeedbackPage = z.object({
  hasMore: z.boolean(),
  rows: z.array(FeedbackRow),
});
export type FeedbackPage = z.infer<typeof FeedbackPage>;

/* The inbox list query: optional status filter and a bounded page window. The
   coercions + defaults mirror the other admin list queries so an absent query
   string is a valid, defaulted request. */
export const FeedbackListQuery = z.object({
  status: FeedbackStatus.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type FeedbackListQuery = z.infer<typeof FeedbackListQuery>;

/* An operator moves a report through its status and/or sets notes in one call.
   Both fields optional, but a request with neither is a no-op the service
   rejects (a 400), the same contract as the abuse-report action. */
export const UpdateFeedbackInput = z
  .object({
    status: FeedbackStatus.optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine((v) => v.status !== undefined || v.notes !== undefined, {
    message: "Nothing to update: pass a status, notes, or both.",
  });
export type UpdateFeedbackInput = z.infer<typeof UpdateFeedbackInput>;
