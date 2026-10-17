"use client";

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

/* The interactive half of the public bio page (#650). The server component
   (page.tsx) decided the page exists (real 404 for a miss); this fetches it in
   the browser so the view/click counters — which must run client-side with
   keepalive — can fire. */

function PerDomain({ domain, slug }: { domain: string; slug: string }) {
  const page = usePublicBioPageByDomain(domain, slug);
  // Belt-and-braces: in fixtures mode the server did not probe, so a genuine
  // miss still 404s here rather than lingering on a soft error card.
  if (page.isError) notFound();
  return (
    <BioPageView
      page={page}
      viewKey={`${domain}/${slug}`}
      recordView={() => void recordBioViewByDomain(domain, slug)}
      recordClick={(blockId) => void recordBioClickByDomain(domain, slug, blockId)}
    />
  );
}

function BySlug({ slug }: { slug: string }) {
  const page = usePublicBioPage(slug);
  if (page.isError) notFound();
  return (
    <BioPageView
      page={page}
      viewKey={slug}
      recordView={() => void recordBioView(slug)}
      recordClick={(blockId) => void recordBioClick(slug, blockId)}
    />
  );
}

export function BioPageClient({ segments }: { segments: string[] }) {
  if (segments.length === 2) {
    const [domain, slug] = segments;
    return <PerDomain domain={domain!} slug={slug!} />;
  }
  if (segments.length === 1) {
    return <BySlug slug={segments[0]!} />;
  }
  notFound();
}
