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
   fields; only a value the user changed is judged. The API's one-minute skew
   tolerance is applied here too, so a slightly fast browser clock never flags a
   date the server would accept (the server stays the authority). */

export function expiryProblem(
  value: string | null | undefined,
  { original, now }: { original: string | null | undefined; now?: Date },
): string | undefined {
  const [problem] = validateExpiry(value, { previous: original, now, toleranceMs: EXPIRY_SKEW_TOLERANCE_MS });
  return problem;
}
