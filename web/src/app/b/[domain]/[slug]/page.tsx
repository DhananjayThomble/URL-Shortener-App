"use client";

import { useParams } from "next/navigation";
import {
  recordBioClickByDomain,
  recordBioViewByDomain,
  usePublicBioPageByDomain,
} from "@/lib/api/hooks";
import { BioPageView } from "../../bio-page-view";

/* The per-domain bio page route (#650): /b/<domain>/<slug>.

   This is where the managed link at <domain>/<slug> 302s a visitor. Addressing
   a page by (domain, slug) is what makes two workspaces' pages at the same
   back-half on different domains distinct — the bug this route fixes. */

export default function PublicBioPageByDomain() {
  const { domain, slug } = useParams<{ domain: string; slug: string }>();
  const page = usePublicBioPageByDomain(domain, slug);

  return (
    <BioPageView
      page={page}
      recordView={() => void recordBioViewByDomain(domain, slug)}
      recordClick={(blockId) => void recordBioClickByDomain(domain, slug, blockId)}
    />
  );
}
