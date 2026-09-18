"use client";

import { useParams } from "next/navigation";
import { Card, CardBody, Skeleton } from "@/components/ui";
import { usePublicBioPage } from "@/lib/api/hooks";

/* The shareable end of a bio page.

   Served by the web app at /b/<slug> rather than on a short domain, the same
   way /f/<slug> serves a form: the redirect service owns the short-domain slug
   namespace, and a bio page competing for it would race a link for the same
   back-half.

   No auth, and no cookies — the same promise the redirect path and the public
   form page make. A visitor sees the profile and the blocks; the workspace's
   view and click analytics never reach here. */

export default function PublicBioPage() {
  const { slug } = useParams<{ slug: string }>();
  const page = usePublicBioPage(slug);

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
  const links = p.blocks.filter((b) => b.kind !== "header");

  return (
    <main className="max-w-[560px] mx-auto px-6 py-[60px]">
      <Card>
        <CardBody className="flex flex-col gap-5 items-center text-center">
          <div
            aria-hidden="true"
            className="w-[64px] h-[64px] rounded-full bg-accent-wash text-accent font-display font-bold text-[22px] flex items-center justify-center"
          >
            {p.profile.initials}
          </div>
          <header>
            <h1 className="font-display text-[22px] font-bold tracking-[-0.02em] m-0">{p.profile.name}</h1>
            {p.profile.bio ? (
              <p className="text-[13.5px] text-ink-2 mt-1.5 mb-0 leading-[1.6]">{p.profile.bio}</p>
            ) : null}
          </header>

          {links.length ? (
            <nav className="w-full flex flex-col gap-2.5">
              {links.map((block, i) =>
                block.href ? (
                  <a
                    key={i}
                    href={block.href}
                    className="w-full px-4 py-3 rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[14px] font-medium text-ink hover:border-accent hover:bg-surface transition-colors no-underline"
                  >
                    {block.title}
                    {block.subtitle ? (
                      <span className="block text-[12px] font-normal text-ink-3 mt-0.5">{block.subtitle}</span>
                    ) : null}
                  </a>
                ) : (
                  <div
                    key={i}
                    className="w-full px-4 py-3 rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[14px] font-medium text-ink-2"
                  >
                    {block.title}
                    {block.subtitle ? (
                      <span className="block text-[12px] font-normal text-ink-3 mt-0.5">{block.subtitle}</span>
                    ) : null}
                  </div>
                ),
              )}
            </nav>
          ) : null}

          <p className="text-[11.5px] text-ink-3 leading-[1.55] m-0 pt-1 border-t border-line w-full">
            Built with SnapURL. No cookies are set by this page.
          </p>
        </CardBody>
      </Card>
    </main>
  );
}
