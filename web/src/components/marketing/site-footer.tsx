import Link from "next/link";

const REPO_URL = "https://github.com/DhananjayThomble/URL-Shortener-App";

const COLUMNS: { heading: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Overview", href: "/product" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    heading: "Developers",
    links: [{ label: "API & SDKs", href: "/for-developers" }],
  },
  {
    heading: "Self-host",
    links: [
      { label: "Run it yourself", href: "/self-host" },
      { label: "Source on GitHub", href: REPO_URL, external: true },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Start free", href: "/register" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line pt-12">
      <div className="grid gap-10 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
        <div className="max-w-[30ch]">
          <Link href="/" className="flex items-center gap-[9px]">
            <span className="w-[27px] h-[27px] rounded-[7px] bg-accent text-accent-ink grid place-items-center font-display font-extrabold text-[15px]">
              S
            </span>
            <b className="font-display text-[16px] font-bold tracking-[-0.02em]">SnapURL</b>
          </Link>
          <p className="mt-3 text-[13px] text-ink-3 leading-[1.6]">
            Short links that outlive your subscription. MIT licensed, self-hostable, and honest about what it counts.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <h4 className="font-mono text-[9.5px] tracking-[0.13em] uppercase text-ink-3 mb-3">{col.heading}</h4>
            <ul className="flex flex-col gap-[9px]">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.external ? (
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[13.5px] text-ink-2 hover:text-ink"
                    >
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className="text-[13.5px] text-ink-2 hover:text-ink">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-12 flex flex-col sm:flex-row items-start sm:items-center gap-2 text-[12px] text-ink-3">
        <span>© {new Date().getFullYear()} SnapURL. MIT licensed.</span>
        <span className="sm:ml-auto">No tracking cookies. Export everything, always.</span>
      </div>
    </footer>
  );
}
