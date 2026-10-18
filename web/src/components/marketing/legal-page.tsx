import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

/* Shared shell for /terms and /privacy (#794).

   Both pages are PLACEHOLDERS. The maintainer owns the legal text, so this
   component makes that impossible to miss: a banner at the top of every page,
   and a visible `TODO(maintainer)` marker wherever a real clause belongs
   (<Todo>). Nothing here is a legal commitment. The only prose that is not a
   TODO restates what the repository already documents, and each such sentence
   names the place it comes from so the maintainer can check it.

   Server components only, no client JS beyond the shared header: these routes
   prerender as static HTML, which keeps them out of the Lighthouse budgets'
   way. */

export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-[1080px] mx-auto px-6 pb-[90px]">
      <SiteHeader />

      <main>
        <header className="pt-[56px] pb-6 max-w-[72ch] mx-auto">
          <h1 className="text-[clamp(30px,4.5vw,44px)] leading-[1.08] font-extrabold tracking-[-0.03em]">{title}</h1>
          <p className="text-[15.5px] text-ink-2 mt-4 leading-[1.65]">{intro}</p>
        </header>

        <div className="max-w-[72ch] mx-auto">
          <div
            role="note"
            data-testid="legal-placeholder-banner"
            className="rounded-[var(--radius-sm)] border border-line-2 bg-wash-warn text-amber px-4 py-3 text-[13.5px] leading-[1.6]"
          >
            <b className="font-mono text-[11px] tracking-[0.11em] uppercase">Placeholder — not yet in force</b>
            <p className="m-0 mt-1">
              This page is a placeholder. The legal text has not been written or reviewed yet and nothing on it is a
              binding commitment. Sections marked <b>TODO(maintainer)</b> are waiting for the project maintainer.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-8">{children}</div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[19px] font-bold tracking-[-0.01em] mb-2">{title}</h2>
      <div className="flex flex-col gap-3 text-[14.5px] text-ink-2 leading-[1.7]">{children}</div>
    </section>
  );
}

/** A visible marker for text the maintainer still has to write. */
export function Todo({ children }: { children: React.ReactNode }) {
  return (
    <p
      data-todo="maintainer"
      className="m-0 rounded-[var(--radius-sm)] border border-dashed border-line-2 bg-surface-3 px-3 py-2 text-[13.5px] text-ink-2"
    >
      <b className="font-mono text-[11px] tracking-[0.08em] uppercase text-ink">TODO(maintainer)</b> {children}
    </p>
  );
}
