"use client";

import { useParams } from "next/navigation";
import { recordBioClick, recordBioView, usePublicBioPage } from "@/lib/api/hooks";
import { BioPageView } from "../bio-page-view";

/* The backward-compatible slug alias for already-shared /b/<slug> URLs (#650).

   New bio pages are addressed per-domain at /b/<domain>/<slug>; this route is
   kept so links shared before that change keep working. It resolves on the
   shared/system domain only — see docs/DECISIONS.md and
   BioPagesService.publicPageBySlug. */

export default function PublicBioPageBySlug() {
  const { slug } = useParams<{ slug: string }>();
  const page = usePublicBioPage(slug);

  return (
    <BioPageView
      page={page}
      recordView={() => void recordBioView(slug)}
      recordClick={(blockId) => void recordBioClick(slug, blockId)}
    />
  );
}
