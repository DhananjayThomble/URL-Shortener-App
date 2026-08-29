"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { label: "Product", href: "/product" },
  { label: "Analytics", href: "/product#analytics" },
  { label: "Developers", href: "/for-developers" },
  { label: "Self-host", href: "/self-host" },
  { label: "Pricing", href: "/pricing" },
];

export function SiteHeader({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <header className={cn("relative", className)}>
      <nav className="flex items-center gap-6 py-[22px]">
        <Link href="/" className="flex items-center gap-[9px]">
          <span className="w-[27px] h-[27px] rounded-[7px] bg-accent text-accent-ink grid place-items-center font-display font-extrabold text-[15px]">
            S
          </span>
          <b className="font-display text-[16px] font-bold tracking-[-0.02em]">SnapURL</b>
        </Link>

        <div className="hidden md:flex gap-[22px] ml-5 text-[13.5px] text-ink-2">
          {NAV_LINKS.map((l) => (
            <Link key={l.label} href={l.href} className="hover:text-ink">
              {l.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto hidden md:flex gap-[9px] items-center">
          <Link
            href="/login"
            className="px-[13px] py-[7px] rounded-[var(--radius-sm)] text-[13px] font-semibold text-ink-2 hover:bg-surface-3 hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="px-[13px] py-[7px] rounded-[var(--radius-sm)] text-[13px] font-semibold bg-accent text-accent-ink hover:bg-accent-2"
          >
            Start free
          </Link>
        </div>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto md:hidden inline-flex items-center justify-center w-[38px] h-[38px] rounded-[var(--radius-sm)] border border-line-2 bg-surface text-ink-2 hover:bg-surface-3 hover:text-ink transition-colors"
        >
          <span aria-hidden className="text-[16px] leading-none">
            {open ? "✕" : "☰"}
          </span>
        </button>
      </nav>

      {open ? (
        <div
          id="mobile-menu"
          className="md:hidden absolute left-0 right-0 top-full z-20 mt-1 flex flex-col gap-1 p-2 bg-surface border border-line rounded-[var(--radius)] shadow-[var(--shadow-2)]"
        >
          {NAV_LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              onClick={() => setOpen(false)}
              className="px-[11px] py-[9px] rounded-[var(--radius-sm)] text-[14px] font-medium text-ink-2 hover:bg-surface-3 hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
          <div className="my-1 h-px bg-line" />
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="px-[11px] py-[9px] rounded-[var(--radius-sm)] text-[14px] font-semibold text-ink-2 hover:bg-surface-3 hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            onClick={() => setOpen(false)}
            className="px-[11px] py-[9px] rounded-[var(--radius-sm)] text-[14px] font-semibold text-center bg-accent text-accent-ink hover:bg-accent-2"
          >
            Start free
          </Link>
        </div>
      ) : null}
    </header>
  );
}
