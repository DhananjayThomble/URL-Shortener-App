"use client";

import { useParams } from "next/navigation";
import { notFound } from "next/navigation";
import {
  recordBioClick,
  recordBioClickByDomain,
  recordBioView,
  recordBioViewByDomain,
  usePublicBioPage,
  usePublicBioPageByDomain,
} from "@/lib/api/hooks";
import { BioPageView } from "../bio-page-view";

/* The public bio page (#650). One optional catch-all route serves both shapes,
   because Next.js forbids two sibling dynamic segments with different names at
   the same path position (`/b/[slug]` and `/b/[domain]/[slug]` collide):

     /b/<domain>/<slug>  — the per-domain route the managed link 302s to. This
                           is what makes two workspaces' pages at the same
                           back-half on different domains distinct.
     /b/<slug>           — the backward-compatible alias for URLs shared before
                           this change. Resolves on the shared/system domain
                           only (see docs/DECISIONS.md). */

function PerDomain({ domain, slug }: { domain: string; slug: string }) {
  const page = usePublicBioPageByDomain(domain, slug);
  return (
    <BioPageView
      page={page}
      recordView={() => void recordBioViewByDomain(domain, slug)}
      recordClick={(blockId) => void recordBioClickByDomain(domain, slug, blockId)}
    />
  );
}

function BySlug({ slug }: { slug: string }) {
  const page = usePublicBioPage(slug);
  return (
    <BioPageView
      page={page}
      recordView={() => void recordBioView(slug)}
      recordClick={(blockId) => void recordBioClick(slug, blockId)}
    />
  );
}

export default function PublicBioPage() {
  const { parts } = useParams<{ parts?: string[] }>();
  const segments = parts ?? [];

  if (segments.length === 2) {
    const [domain, slug] = segments;
    return <PerDomain domain={domain!} slug={slug!} />;
  }
  if (segments.length === 1) {
    return <BySlug slug={segments[0]!} />;
  }
  // /b with no slug, or a deeper path, is not an address.
  notFound();
}
