import { EXPIRY_SKEW_TOLERANCE_MS, validateExpiry } from "@snapurl/domain/expiry";

/* The "Expiry date" field of the create/edit link drawers (issue #754).

   Picking a day that has already passed used to create a link that was expired
   from birth. The field now says so inline, with the same rule and the same
   words the API uses (validateExpiry in packages/domain), so the two can never
   disagree about what counts as "the past".

   The field holds an ISO instant: a picked day becomes the END of that day in
   the viewer's local time (dateInputToIso), so "today" is always allowed and
   the first refused day is yesterday in the viewer's own calendar.

   `original` is the expiry the form was opened with — null on create. On edit,
   leaving an expired link's expiry as it is must not block saving its other
   fields; only a value the user changed is judged.

   The skew tolerance follows the API EXACTLY, per caller: edit keeps the
   one-minute tolerance so "expire this now" (the current time, a client clock
   slightly ahead) is accepted — the same as LinksService.update. Create passes
   NONE — a brand-new link expiring "now" is born expired, so the API's create
   path rejects it with no tolerance. Applying edit's tolerance on create was a
   bug: in the first minute after local midnight, yesterday maps to 23:59:59.999
   — under a minute behind — so the drawer accepted a date the API then refused,
   and the error only showed as the footer server error. */

export function expiryProblem(
  value: string | null | undefined,
  { mode, original, now }: { mode: "create" | "edit"; original: string | null | undefined; now?: Date },
): string | undefined {
  const [problem] = validateExpiry(value, {
    previous: original,
    now,
    // Match the API: no tolerance on create, one minute on edit.
    toleranceMs: mode === "edit" ? EXPIRY_SKEW_TOLERANCE_MS : 0,
  });
  return problem;
}
