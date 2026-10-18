/* #849 — dynamic route segments, decoded exactly once.

   Next 15.5 hands a dynamic segment back as it appears in the URL, still
   percent-encoded ("localhost%3A3002"). Everything downstream (the API hooks,
   the server-side existence probe) builds its own path with encodeURIComponent,
   so an undecoded segment is encoded TWICE ("localhost%253A3002") and the API
   answers 404 for a page that exists. Decode here, once, and let the consumers
   encode once. */

/** The segment as the visitor meant it, or null when it carries a malformed
 *  escape (a lone "%", "%zz", a truncated or overlong UTF-8 sequence). null is
 *  "no such address": the caller answers a 404, not a 500 from a thrown
 *  URIError. */
export function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Every segment decoded once; null when ANY segment is malformed. A missing
 *  list is the route with no segments (e.g. a bare /b). */
export function decodeSegments(raw: readonly string[] | undefined): string[] | null {
  const out: string[] = [];
  for (const part of raw ?? []) {
    const decoded = decodeSegment(part);
    if (decoded === null) return null;
    out.push(decoded);
  }
  return out;
}

/** The public bio-page API path for DECODED /b segments, or null when the
 *  segment count is not an address. Two segments are the per-domain route,
 *  one is the system-domain slug alias. */
export function bioPublicPath(segments: readonly string[]): string | null {
  if (segments.length === 2) {
    return `/public/bio-pages/by-domain/${encodeURIComponent(segments[0]!)}/${encodeURIComponent(segments[1]!)}`;
  }
  if (segments.length === 1) {
    return `/public/bio-pages/${encodeURIComponent(segments[0]!)}`;
  }
  return null;
}
