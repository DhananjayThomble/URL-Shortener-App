"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui";
import { useLinks, useLogout, useMe, useWorkspace } from "@/lib/api/hooks";
import { cn, compact } from "@/lib/utils";

type Counts = { links?: number; bio?: number; domains?: number; members?: number };

const NAV: { group: string; items: { href: string; label: string; icon: string; count?: keyof Counts }[] }[] = [
  {
    group: "Workspace",
    items: [
      { href: "/links", label: "Links", icon: "⛓", count: "links" },
      { href: "/analytics", label: "Analytics", icon: "▤" },
      { href: "/qr", label: "QR studio", icon: "▩" },
      { href: "/bio", label: "Bio pages", icon: "☰", count: "bio" },
      { href: "/forms", label: "Forms", icon: "▧" },
      { href: "/conversions", label: "Conversions", icon: "⇄" },
    ],
  },
  {
    group: "Configure",
    items: [
      { href: "/domains", label: "Domains", icon: "◈", count: "domains" },
      { href: "/reports", label: "Abuse reports", icon: "⚑" },
      { href: "/developers", label: "Developers", icon: "⌘" },
      { href: "/team", label: "Team", icon: "◐", count: "members" },
      { href: "/settings", label: "Settings", icon: "⚙" },
    ],
  },
];

/**
 * The navigation list, shared verbatim by the desktop {@link Sidebar} and the
 * mobile {@link MobileNav} drawer, so the two can never drift: both iterate the
 * single NAV array above. `onNavigate` lets the mobile drawer close itself when
 * a destination is tapped; the desktop sidebar passes nothing.
 */
function NavLinks({ counts, onNavigate }: { counts: Counts; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {NAV.map((section) => (
        <React.Fragment key={section.group}>
          <div className="font-mono text-[9.5px] tracking-[0.13em] uppercase text-ink-3 px-[10px] pt-[14px] pb-[6px]">
            {section.group}
          </div>
          {section.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const count = item.count ? counts[item.count] : undefined;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-[10px] px-[10px] rounded-[var(--radius-sm)] text-[13.5px] font-medium transition-colors",
                  "py-[calc(7px*var(--density))]",
                  active ? "bg-accent-wash text-accent font-semibold" : "text-ink-2 hover:bg-surface-3 hover:text-ink",
                )}
              >
                <span className="w-4 text-center opacity-85 shrink-0">{item.icon}</span>
                {item.label}
                {count !== undefined ? (
                  <span className="ml-auto font-mono text-[11px] text-ink-3 tnum">{compact(count)}</span>
                ) : null}
              </Link>
            );
          })}
        </React.Fragment>
      ))}
    </>
  );
}

/** The monthly-clicks quota meter, shared by the desktop sidebar and mobile drawer. */
function QuotaMeter() {
  const { data: ws } = useWorkspace();
  const usedPct = ws ? Math.min(100, Math.round((ws.clicksUsed / ws.clicksIncluded) * 100)) : 0;
  return (
    <div className="px-[10px] py-[9px]">
      <div className="flex justify-between text-[11.5px] text-ink-3 mb-[6px]">
        <span>Clicks this month</span>
        <b className="text-ink-2 font-mono tnum">
          {ws ? `${compact(ws.clicksUsed)} / ${compact(ws.clicksIncluded)}` : "—"}
        </b>
      </div>
      <div className="h-1 bg-surface-4 rounded-full overflow-hidden">
        <i className="block h-full bg-accent rounded-full" style={{ width: `${usedPct}%` }} />
      </div>
      <p className="text-[10.5px] text-ink-3 mt-[7px] leading-[1.45]">
        One quota, clicks only. Links, QR codes and edits are never metered.
      </p>
    </div>
  );
}

export function Sidebar({ counts, onCreate }: { counts: Counts; onCreate: () => void }) {
  const { data: ws } = useWorkspace();

  return (
    <aside className="hidden lg:flex flex-col gap-[5px] bg-surface border-r border-line p-[16px_12px] sticky top-0 h-screen overflow-y-auto w-[228px] shrink-0">
      <Link href="/links" className="flex items-center gap-[9px] px-2 pt-1 pb-4">
        <span className="w-[27px] h-[27px] rounded-[7px] bg-accent text-accent-ink grid place-items-center font-display font-extrabold text-[15px] shrink-0">
          S
        </span>
        <b className="font-display text-[16px] font-bold tracking-[-0.02em]">SnapURL</b>
      </Link>

      <button className="flex items-center gap-[9px] px-[9px] py-[7px] border border-line rounded-[var(--radius-sm)] mb-[14px] hover:border-line-2 hover:bg-surface-2 transition-colors">
        <span className="w-5 h-5 rounded-[5px] bg-violet text-white grid place-items-center text-[10px] font-bold shrink-0">
          {ws?.initials ?? "··"}
        </span>
        <span className="flex-1 min-w-0 text-[13px] font-semibold truncate text-left">{ws?.name ?? "Loading…"}</span>
        <span className="text-ink-3 text-[10px]">▾</span>
      </button>

      <Button variant="primary" className="w-full justify-center mb-[6px]" onClick={onCreate}>
        ＋ New link
      </Button>

      <NavLinks counts={counts} />

      <div className="mt-auto pt-[14px] border-t border-line">
        <QuotaMeter />
      </div>
    </aside>
  );
}

/**
 * Primary navigation for viewports below `lg`, where the desktop {@link Sidebar}
 * is `hidden`. A hamburger button in the {@link Topbar} opens a full-height
 * drawer that reuses the same {@link NavLinks}/{@link QuotaMeter} as the sidebar,
 * so a phone user can reach every section — the gap DC1 flagged (nav unreachable
 * below 1024px with no replacement). It is `lg:hidden`; at `lg` and up nothing
 * here renders and the sidebar takes over, so the desktop layout is untouched.
 */
function MobileNav({ counts, onCreate }: { counts: Counts; onCreate: () => void }) {
  const { data: ws } = useWorkspace();
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes (a nav tap navigates via the
  // client router, so the drawer must not linger over the new page).
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on Escape while open, and lock body scroll behind the overlay.
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open navigation menu"
        className="w-11 h-11 -ml-2 grid place-items-center text-[18px] text-ink-2 hover:text-ink rounded-[var(--radius-sm)] hover:bg-surface-3 transition-colors"
      >
        ☰
      </button>

      {open ? (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Navigation">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <nav className="absolute left-0 top-0 h-full w-[272px] max-w-[85vw] bg-surface border-r border-line flex flex-col gap-[5px] p-[16px_12px] overflow-y-auto shadow-xl">
            <div className="flex items-center gap-[9px] px-2 pt-1 pb-4">
              <span className="w-[27px] h-[27px] rounded-[7px] bg-accent text-accent-ink grid place-items-center font-display font-extrabold text-[15px] shrink-0">
                S
              </span>
              <b className="font-display text-[16px] font-bold tracking-[-0.02em]">SnapURL</b>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="ml-auto w-11 h-11 grid place-items-center text-[18px] text-ink-3 hover:text-ink rounded-[var(--radius-sm)] hover:bg-surface-3 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-[9px] px-[9px] py-[7px] border border-line rounded-[var(--radius-sm)] mb-[14px]">
              <span className="w-5 h-5 rounded-[5px] bg-violet text-white grid place-items-center text-[10px] font-bold shrink-0">
                {ws?.initials ?? "··"}
              </span>
              <span className="flex-1 min-w-0 text-[13px] font-semibold truncate text-left">{ws?.name ?? "Loading…"}</span>
            </div>

            <Button
              variant="primary"
              className="w-full justify-center mb-[6px]"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
            >
              ＋ New link
            </Button>

            <NavLinks counts={counts} onNavigate={() => setOpen(false)} />

            <div className="mt-auto pt-[14px] border-t border-line">
              <QuotaMeter />
            </div>
          </nav>
        </div>
      ) : null}
    </div>
  );
}

export function Topbar({ counts, onCreate }: { counts: Counts; onCreate: () => void }) {
  return (
    <div className="flex items-center gap-3 px-[14px] sm:px-[22px] h-14 border-b border-line bg-surface sticky top-0 z-20">
      <MobileNav counts={counts} onCreate={onCreate} />
      <button
        onClick={onCreate}
        className="tap-target lg:hidden max-lg:w-11 max-lg:h-11 inline-flex items-center justify-center text-[17px] font-semibold text-accent"
        aria-label="Create a link"
      >
        ＋
      </button>
      <TopbarSearch />
      <div className="ml-auto flex items-center gap-[9px]">
        <Button size="sm" variant="ghost" className="hidden sm:inline-flex">
          Import from Bitly
        </Button>
        <AccountMenu />
      </div>
    </div>
  );
}

/**
 * The top-bar link search (DC5 follow-up, issue #408).
 *
 * The input that lived here was a non-functional stub — placeholder text with
 * no handler and no route. This wires it into an accessible combobox that
 * queries the workspace's links as you type and shows matches in a listbox
 * directly under the input.
 *
 * Filtering is done SERVER-SIDE through the existing links hook: `useLinks`
 * sends `?search=` to GET /links, and LinksService.list (and the fixtures
 * backend, web/src/lib/api/fixtures.ts) already filter slug/destination/title/
 * comment by that term. So there is no client-side re-filtering and no fixtures
 * change — the dropdown shows exactly what the links page would for the same
 * query, just capped to a handful of rows.
 *
 * Layout is unchanged from the stub: the same `flex-1 max-w-[400px] hidden
 * sm:flex` wrapper, so the control is desktop/tablet only (DC5 keeps search off
 * phones) and the desktop bar is visually identical until the user types.
 *
 * A11y: input is role="combobox" with aria-expanded / aria-controls /
 * aria-activedescendant; results are a role="listbox" of role="option" rows.
 * ArrowUp/Down move the active option, Enter opens it, Escape closes. The
 * dropdown closes on outside-click and on route change.
 */
function TopbarSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  const [raw, setRaw] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  // Debounce the typed value (~250ms) into `query`, which is what actually
  // drives the request — so a fast typist fires one query, not one per keypress.
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(raw.trim()), 250);
    return () => clearTimeout(t);
  }, [raw]);

  // Only query when there is a non-empty term; an empty query means the dropdown
  // is closed and nothing is fetched.
  const enabled = query.length > 0;
  const { data, isFetching } = useLinks(enabled ? { search: query, limit: 8 } : undefined);
  const results = enabled ? (data?.items ?? []) : [];

  // Keep the highlighted row in range as results change, and open the dropdown
  // whenever there is a live query.
  React.useEffect(() => {
    setActive(0);
  }, [query]);
  React.useEffect(() => {
    if (enabled) setOpen(true);
  }, [enabled]);

  // Close on route change — navigating to a result (or anywhere) must not leave
  // the dropdown floating over the new page.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const go = (id: string) => {
    setOpen(false);
    setRaw("");
    setQuery("");
    router.push(`/links/${id}`);
  };

  const showDropdown = open && enabled;
  const showEmpty = showDropdown && !isFetching && results.length === 0;
  const activeId = results.length > 0 ? `${listId}-opt-${active}` : undefined;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!showDropdown) setOpen(true);
      if (results.length > 0) setActive((i) => (i + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length > 0) setActive((i) => (i - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      const hit = results[active];
      if (hit) {
        event.preventDefault();
        go(hit.id);
      }
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative flex-1 max-w-[400px] hidden sm:flex items-center"
    >
      <div className="flex-1 flex items-center gap-2 px-[11px] py-[6px] bg-surface-2 border border-line rounded-[var(--radius-sm)] text-[13px] focus-within:border-line-2">
        <span aria-hidden className="text-ink-3">⌕</span>
        <input
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showDropdown ? activeId : undefined}
          aria-label="Search links, slugs, destinations, tags"
          placeholder="Search links, slugs, destinations, tags"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onFocus={() => {
            if (enabled) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="flex-1 min-w-0 bg-transparent outline-none text-ink placeholder:text-ink-3 truncate"
        />
        <kbd className="ml-auto font-mono text-[10px] px-[5px] py-px border border-line-2 rounded-[4px] text-ink-3 hidden sm:block">
          ⌘K
        </kbd>
      </div>

      {showDropdown ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] bg-surface border border-line rounded-[var(--radius-sm)] shadow-lg py-[5px] z-40 overflow-hidden"
        >
          {results.length > 0 ? (
            <ul id={listId} role="listbox" aria-label="Link results" className="max-h-[320px] overflow-y-auto">
              {results.map((link, i) => (
                <li
                  key={link.id}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    // mousedown (not click) so the input's blur/outside-close
                    // does not fire first and cancel the navigation.
                    e.preventDefault();
                    go(link.id);
                  }}
                  className={cn(
                    "px-[11px] py-[7px] cursor-pointer flex flex-col gap-[1px]",
                    i === active ? "bg-surface-3" : "hover:bg-surface-3",
                  )}
                >
                  <span className="font-mono text-[13px] font-semibold text-ink truncate">
                    <span className="text-ink-3">{link.domain}/</span>
                    <span className="text-accent">{link.slug}</span>
                    <span className="ml-2 font-sans font-normal text-ink-3 tnum">{compact(link.clicks)} clicks</span>
                  </span>
                  <span className="text-[12px] text-ink-3 truncate">{link.destination}</span>
                </li>
              ))}
            </ul>
          ) : showEmpty ? (
            <div id={listId} role="listbox" aria-label="Link results" className="px-[11px] py-[9px] text-[13px] text-ink-3">
              No matches
            </div>
          ) : (
            <div id={listId} role="listbox" aria-label="Link results" className="px-[11px] py-[9px] text-[13px] text-ink-3">
              Searching…
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The avatar, and the only way to sign out of the app.
 *
 * Until now there was no sign-out control anywhere in the product — the hook
 * existed with zero call sites, so a signed-in user had no way to leave except
 * clearing site data.
 */
function AccountMenu() {
  const { data: me } = useMe();
  const { data: ws } = useWorkspace();
  const logout = useLogout();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape. Both listeners are only attached
  // while the menu is open, so a closed menu costs nothing.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const signOut = () => {
    setOpen(false);
    logout();
    router.replace("/login");
  };

  const initials = me?.initials ?? ws?.initials ?? "··";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={me ? `Account menu for ${me.name}` : "Account menu"}
        className="tap-target inline-flex items-center justify-center shrink-0 rounded-full hover:opacity-90 transition-opacity"
      >
        <span
          aria-hidden
          className="w-[29px] h-[29px] rounded-full bg-teal text-white grid place-items-center text-[11.5px] font-bold"
        >
          {initials}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+7px)] min-w-[196px] bg-surface border border-line rounded-[var(--radius-sm)] shadow-lg py-[5px] z-30"
        >
          {me ? (
            <div className="px-[11px] py-[7px] border-b border-line mb-[4px]">
              <div className="text-[12.5px] font-semibold truncate">{me.name}</div>
              <div className="text-[11.5px] text-ink-3 truncate">{me.email}</div>
            </div>
          ) : null}
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-[11px] py-[6px] text-[13px] text-ink-2 hover:bg-surface-3 hover:text-ink transition-colors"
          >
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="w-full text-left px-[11px] py-[6px] text-[13px] text-ink-2 hover:bg-surface-3 hover:text-ink transition-colors"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PageHead({
  title,
  sub,
  actions,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 mb-5 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-[24px] font-bold">{title}</h1>
        {sub ? <div className="text-[13.5px] text-ink-3 mt-[3px]">{sub}</div> : null}
      </div>
      {actions ? <div className="ml-auto flex gap-2 flex-wrap">{actions}</div> : null}
    </div>
  );
}
