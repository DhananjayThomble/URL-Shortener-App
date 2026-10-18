import type { ReactNode } from "react";
import { Card, CardBody } from "@/components/ui";
import { safeHttpHref } from "@/lib/bio-page";

/* The bio page itself (#788) — avatar, name, bio, one row per block, footer.

   ONE component renders it in both places: the public page (/b/…) and the
   editor's live preview (/bio). The preview used to be a hand-drawn phone
   mock-up with its own button styles and footer, so it described a page that
   did not exist. Anything a visitor sees is decided here and nowhere else.

   Rendering is XSS-safe by construction: every string is a React text child
   (escaped), and an href only becomes a link when it is an absolute http(s)
   URL — a `javascript:` or `data:` value typed into the editor renders as an
   inert row, never as something a click can run. */

const BLOCK_ICON: Record<string, string> = { embed: "▶", email: "✉", social: "◈" };

export type BioCardBlock = {
  /** React key, and what `onBlockClick` is called with. */
  id: string;
  kind: "header" | "link" | "embed" | "email" | "social";
  title: string;
  subtitle?: string | null;
  href?: string | null;
};

export type BioCardProfile = { name: string; bio: string; initials: string };

const ROW =
  "w-full px-4 py-3 rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[14px] font-medium";

function Subtitle({ children }: { children: ReactNode }) {
  return <span className="block text-[12px] font-normal text-ink-3 mt-0.5">{children}</span>;
}

export function BioPageCard({
  profile,
  blocks,
  onBlockClick,
  preview = false,
  headingLevel = "h1",
}: {
  profile: BioCardProfile;
  blocks: BioCardBlock[];
  /** Public page: counts the click before the browser follows the link. */
  onBlockClick?: (blockId: string) => void;
  /** Editor preview: same markup, but links are inert (no href, no focus) so
   *  clicking one cannot navigate away from unsaved work. */
  preview?: boolean;
  /** The editor page already owns an <h1>; its preview uses an <h2>. */
  headingLevel?: "h1" | "h2";
}) {
  const Heading = headingLevel;
  // The public page's links are navigation; inside the editor a second <nav>
  // landmark would only add noise for a screen reader.
  const Links = preview ? "div" : "nav";
  const rows = blocks.filter((b) => b.kind !== "header");

  return (
    <Card>
      <CardBody className="flex flex-col gap-5 items-center text-center">
        <div
          aria-hidden="true"
          data-testid="bio-avatar"
          className="w-[64px] h-[64px] rounded-full bg-accent-wash text-accent font-display font-bold text-[22px] flex items-center justify-center"
        >
          {profile.initials}
        </div>
        <header className="max-w-full">
          <Heading className="font-display text-[22px] font-bold tracking-[-0.02em] m-0 break-words">
            {profile.name}
          </Heading>
          {profile.bio ? (
            <p className="text-[13.5px] text-ink-2 mt-1.5 mb-0 leading-[1.6] break-words">{profile.bio}</p>
          ) : null}
        </header>

        {rows.length ? (
          <Links className="w-full flex flex-col gap-2.5" data-testid="bio-card-blocks">
            {rows.map((block) => {
              const href = safeHttpHref(block.href);
              const icon = BLOCK_ICON[block.kind];
              const content = (
                <>
                  {icon ? <span aria-hidden="true">{icon} </span> : null}
                  {block.title}
                  {block.subtitle ? <Subtitle>{block.subtitle}</Subtitle> : null}
                </>
              );
              if (!href) {
                return (
                  <div key={block.id} className={`${ROW} text-ink-2 break-words`}>
                    {block.title}
                    {block.subtitle ? <Subtitle>{block.subtitle}</Subtitle> : null}
                  </div>
                );
              }
              const linkClass = `${ROW} text-ink hover:border-accent hover:bg-surface transition-colors no-underline break-words block`;
              return preview ? (
                // No href: a placeholder anchor keeps the exact link styling
                // but is not focusable and goes nowhere.
                <a key={block.id} className={linkClass} aria-disabled="true">
                  {content}
                </a>
              ) : (
                <a
                  key={block.id}
                  href={href}
                  rel="noopener"
                  onClick={() => onBlockClick?.(block.id)}
                  className={linkClass}
                >
                  {content}
                </a>
              );
            })}
          </Links>
        ) : null}

        <p className="text-[11.5px] text-ink-3 leading-[1.55] m-0 pt-1 border-t border-line w-full">
          Built with SnapURL. No cookies are set by this page.
        </p>
      </CardBody>
    </Card>
  );
}
