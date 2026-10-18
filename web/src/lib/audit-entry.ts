import { describeAuditAction, isAuditAction } from "@snapurl/domain/audit";

/* #783 — what the team page shows after the actor's name in "Recent activity".

   The API already renders each entry into a sentence (GET /audit returns
   "Created the form /f/feedback", not "form.created"). This is the deploy-skew
   guard: an older API, or a row whose key this API build predates, can still
   hand back a bare key, and a raw "form.created" is exactly what QA saw. Such a
   value is rendered with the same copy table the API uses (without metadata,
   which the response does not carry), and any other dotted key is humanised.
   A sentence passes through untouched. */

const RAW_KEY = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;

export function auditEntryText(action: string): string {
  const trimmed = action.trim();
  if (isAuditAction(trimmed) || RAW_KEY.test(trimmed)) return describeAuditAction(trimmed);
  return action;
}
