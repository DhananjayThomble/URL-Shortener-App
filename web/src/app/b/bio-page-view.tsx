"use client";

import { useEffect, useRef } from "react";
import { Card, CardBody, Skeleton } from "@/components/ui";
import { BioPageCard } from "@/components/bio/bio-page-card";
import type { PublicBioPage } from "@snapurl/contract";
import type { UseQueryResult } from "@tanstack/react-query";


/* The shareable end of a bio page (#650).

   Rendered by two routes: /b/<domain>/<slug> (the per-domain route the managed
   link 302s to) and /b/<slug> (the backward-compatible alias for already-shared
   URLs). Both pass the same `page` query and a `recordView`/`recordClick` pair;
   this component is the view they share so the markup never drifts between them.

   No auth, and no cookies — the same promise the redirect path and the public
   form page make. A visitor sees the profile and the blocks; the workspace's
   view and click analytics never reach here. */

export function BioPageView({
  page,
  viewKey,
  recordView,
  recordClick,
}: {
  page: UseQueryResult<PublicBioPage>;
  /** The address identity this view belongs to — "<domain>/<slug>" for the
   *  per-domain route, "<slug>" for the alias. Keying the once-only guard on
   *  this (not the resolved slug alone) makes navigating between two pages that
   *  share a slug on different domains count a view for each (#734 finding 9). */
  viewKey: string;
  recordView: () => void;
  recordClick: (blockId: string) => void;
}) {
  /* One view per page load — not per refetch, and not twice under React's
     dev-mode double effect. Only once the page actually resolved, so a 404
     counts nothing. */
  const counted = useRef<string | null>(null);
  const resolved = Boolean(page.data);
  useEffect(() => {
    if (!resolved || counted.current === viewKey) return;
    counted.current = viewKey;
    recordView();
    // recordView is a stable closure for a given address; keying the guard on
    // (domain, slug) is what prevents a double count while still re-counting a
    // genuine navigation to a different address that happens to share a slug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, viewKey]);

  if (page.isLoading) {
    return (
      <main className="max-w-[560px] mx-auto px-6 py-[60px]">
        <Skeleton className="h-[420px]" />
      </main>
    );
  }

  if (page.isError || !page.data) {
    return (
      <main className="max-w-[560px] mx-auto px-6 py-[60px]">
        <Card>
          <CardBody className="text-center py-[44px]">
            <div className="text-[26px] mb-2">🔍</div>
            <h1 className="font-display text-[18px] font-bold m-0 mb-1">There&apos;s no page here</h1>
            <p className="text-[13px] text-ink-3 m-0">
              The address may be wrong, or the page may not be published yet.
            </p>
          </CardBody>
        </Card>
      </main>
    );
  }

  const p = page.data;

  return (
    <main className="max-w-[560px] mx-auto px-6 py-[60px]">
      <BioPageCard profile={p.profile} blocks={p.blocks} onBlockClick={recordClick} />
    </main>
  );
}
