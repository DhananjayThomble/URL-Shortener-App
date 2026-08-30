import { z } from "zod";

/* ============================================================
   Abuse reports — #291.

   The public intake is unauthenticated: anyone can tell an operator that a
   short link points at phishing or malware. The wire format lives here so the
   web form and the API validate the exact same shape.
   ============================================================ */

/* The slug is not in the body — it comes from the route @Param, exactly like
   the unlock endpoint. A reason has to be non-trivial (a blank box tells the
   operator nothing) but must not demand an essay; 3 characters is a floor that
   rejects "" and " " while 2000 is generous enough for a full description. */
export const SubmitReportInput = z.object({
  reason: z.string().min(3, "Tell us what's wrong with this link.").max(2000),
  /* Optional contact so the operator can follow up. Validated as an email when
     present, but an empty string is allowed and treated as "not provided" —
     the same forgiving shape CreateFormInput.slug uses. 320 = max email length. */
  reporterContact: z.string().email().max(320).optional().or(z.literal("")),
});
export type SubmitReportInput = z.infer<typeof SubmitReportInput>;

/* A deliberately opaque acknowledgement. The endpoint always answers { ok:true }
   whether or not the slug resolves, so it cannot be used to enumerate which
   slugs exist — see the reasoning in ReportsService.submitReport. */
export const SubmitReportResult = z.object({ ok: z.boolean() });
export type SubmitReportResult = z.infer<typeof SubmitReportResult>;

/* ---- operator-side shapes (used by FEAT-003) ---- */

export const AbuseReportStatus = z.enum(["open", "reviewed", "dismissed", "actioned"]);
export type AbuseReportStatus = z.infer<typeof AbuseReportStatus>;

export const AbuseReport = z.object({
  id: z.string(),
  slug: z.string(),
  reason: z.string(),
  reporterContact: z.string().nullable(),
  status: AbuseReportStatus,
  linkId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AbuseReport = z.infer<typeof AbuseReport>;

/* An operator can move a report through its status and/or flag the underlying
   link in a single call. Both fields are optional, but a request with neither
   is a no-op the service should reject. */
export const UpdateAbuseReportInput = z.object({
  status: AbuseReportStatus.optional(),
  flagLink: z.boolean().optional(),
});
export type UpdateAbuseReportInput = z.infer<typeof UpdateAbuseReportInput>;
