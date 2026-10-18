import { notFound } from "next/navigation";
import { bioPublicPath, decodeSegments } from "@/lib/route-segments";
import { BioPageClient } from "./bio-page-client";

/* The public bio page (#650). One optional catch-all route serves both shapes,
   because Next.js forbids two sibling dynamic segments with different names at
   the same path position (`/b/[slug]` and `/b/[domain]/[slug]` collide):

     /b/<domain>/<slug>  — the per-domain route the managed link 302s to.
     /b/<slug>           — the backward-compatible alias (system domain only).

   SERVER component so a MISSING page is a REAL HTTP 404 (#734 finding 10), not
   a soft 200 shell. Against the real API it probes existence server-side and
   calls notFound() on a 404. In fixtures mode (dev/CI — the fake backend is
   browser-only, there is no server to fetch) it skips the probe and lets the
   client view resolve; the fixtures/mocked-api E2E lanes drive the browser. */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
const USE_FIXTURES = process.env.NEXT_PUBLIC_USE_FIXTURES === "true";

// Per request: the probe must reflect a page published/deleted since build, so
// the route is never prerendered or cached into a stale 200/404.
export const dynamic = "force-dynamic";

export default async function PublicBioPage({ params }: { params: Promise<{ parts?: string[] }> }) {
  const { parts } = await params;
  /* #849 — Next hands the segments back still percent-encoded
     ("localhost%3A3002"); the probe below and the client hooks each encode
     once more, so decode here, once. A malformed escape is no address at all:
     a 404, not the URIError (500) a bare decodeURIComponent would throw. */
  const segments = decodeSegments(parts);
  if (!segments) notFound();

  const path = bioPublicPath(segments);
  if (!path) notFound(); // /b with no slug, or a deeper path, is not an address.

  if (!USE_FIXTURES) {
    /* notFound() works by throwing a Next.js sentinel, so it must run OUTSIDE
       the try — inside it the catch would swallow the sentinel and render a
       soft 200. Only the fetch itself is guarded. */
    let status: number | null = null;
    try {
      const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
      status = res.status;
    } catch {
      // A network error reaching the API is not "this page does not exist" —
      // let the client render and surface it.
    }
    if (status === 404) notFound();
  }

  return <BioPageClient segments={segments} />;
}
