"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui";
import { useLogout, useMe, useWorkspace } from "@/lib/api/hooks";
import { cn, compact } from "@/lib/utils";

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
      { href: "/developers", label: "Developers", icon: "⌘" },
      { href: "/team", label: "Team", icon: "◐", count: "members" },
      { href: "/settings", label: "Settings", icon: "⚙" },
    ],
  },
];

type Counts = { links?: number; bio?: number; domains?: number; members?: number };

export function Sidebar({ counts, onCreate }: { counts: Counts; onCreate: () => void }) {
  const pathname = usePathname();
  const { data: ws } = useWorkspace();
  const usedPct = ws ? Math.min(100, Math.round((ws.clicksUsed / ws.clicksIncluded) * 100)) : 0;

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

      <div className="mt-auto pt-[14px] border-t border-line">
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
      </div>
    </aside>
  );
}

export function Topbar({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex items-center gap-3 px-[22px] h-14 border-b border-line bg-surface sticky top-0 z-20">
      <button
        onClick={onCreate}
        className="lg:hidden text-[13px] font-semibold text-accent"
        aria-label="Create a link"
      >
        ＋
      </button>
      <div className="flex-1 max-w-[400px] flex items-center gap-2 px-[11px] py-[6px] bg-surface-2 border border-line rounded-[var(--radius-sm)] text-ink-3 text-[13px]">
        <span aria-hidden>⌕</span>
        <span className="truncate">Search links, slugs, destinations, tags</span>
        <kbd className="ml-auto font-mono text-[10px] px-[5px] py-px border border-line-2 rounded-[4px] hidden sm:block">
          ⌘K
        </kbd>
      </div>
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
        className="w-[29px] h-[29px] rounded-full bg-teal text-white grid place-items-center text-[11.5px] font-bold shrink-0 hover:opacity-90 transition-opacity"
      >
        {initials}
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
