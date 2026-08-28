/* ============================================================
   The wire contract with the NestJS API.

   This file used to be a 321-line hand-copy of the schemas, maintained in
   parallel with packages/contract and drifting from it — by the time it was
   replaced it was missing Link.expiresTo, LinkList.nextCursor,
   Workspace.currency, ConversionsReport.currency and eleven input schemas,
   every one of which the API already accepted or returned.

   It is now a re-export. @snapurl/contract is the single source of truth and
   both this app and apps/api import the same objects, so a payload change
   breaks tsc on both sides instead of silently disagreeing at runtime.

   Import from "@snapurl/contract" directly in new code. This module stays
   because a dozen components already import from "@/lib/api/types", and
   pointing them all at the package is churn that belongs in its own commit.
   ============================================================ */

export * from "@snapurl/contract";
