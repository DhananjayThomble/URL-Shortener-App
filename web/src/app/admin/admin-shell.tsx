"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminMe } from "@snapurl/contract";
import { cn } from "@/lib/utils";

/* #968 — the admin area's layout and navigation shell. Rendered only once the
   server has confirmed the caller is a platform admin (see AdminGate). The
   navigation is intentionally small for now — the foundation part ships just
   the overview; later parts of the epic (#975) add their own entries here. */

interface NavItem {
  href: string;
  label: string;
}

/** The admin nav. Kept as data so later epic parts add a line, not a layout. */
const NAV: NavItem[] = [
  { href: "/admin", label: "Overview" },
  // #969 — users and workspaces management.
  { href: "/admin/users", label: "Users" },
  { href: "/admin/workspaces", label: "Workspaces" },
  // #971 — moderation and abuse.
  { href: "/admin/moderation", label: "Moderation" },
  // #997 — the "Report a problem" feedback inbox.
  { href: "/admin/feedback", label: "Feedback" },
  // #973 — platform-wide analytics.
  { href: "/admin/analytics", label: "Analytics" },
  // #972 — runtime platform settings.
  { href: "/admin/settings", label: "Settings" },
  // #974 — system health and operations.
  { href: "/admin/health", label: "System health" },
];

export function AdminShell({ admin, children }: { admin: AdminMe; children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line-1 bg-surface-1">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">SnapURL</span>
            <span className="text-sm font-semibold text-ink-1">Admin</span>
          </div>
          <div className="text-xs text-ink-3" data-testid="admin-identity">
            {admin.name} · {admin.email}
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-6 flex gap-8">
        <nav aria-label="Admin" className="w-44 shrink-0">
          <ul className="space-y-1">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-3 py-2 text-sm",
                      active ? "bg-surface-2 text-ink-1 font-medium" : "text-ink-3 hover:text-ink-1 hover:bg-surface-2",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
