import { ApiError } from "./api/client";

/**
 * What a failed load of a single record (a detail page) means for the person
 * looking at it — the decision the page needs in order to offer the right way out.
 *
 *  - `not-found`: the record is not there for this person. The API answers the
 *    same 404 for "never existed" and "belongs to another workspace" on purpose,
 *    so the page cannot (and must not) say which. A malformed id is a 400 from
 *    the route's UUID pipe and reads the same to the user. Retrying repeats the
 *    answer, so the way out is back to the list.
 *  - `forbidden`: a 403. Retrying cannot grant permission either.
 *  - `retry`: anything else — a 5xx, a throttle, a dropped connection — where
 *    trying again is a sensible thing to do.
 *
 * Only for GET-by-id routes: on a route that also takes a request body, a 400
 * can mean something else.
 */
export type DetailLoadErrorKind = "not-found" | "forbidden" | "retry";

export function detailLoadErrorKind(error: unknown): DetailLoadErrorKind {
  if (!(error instanceof ApiError)) return "retry";
  if (error.status === 404 || error.status === 400) return "not-found";
  if (error.status === 403) return "forbidden";
  return "retry";
}
