"use client";

import { cn } from "@/lib/utils";
import { usePlatformBanner } from "@/lib/api/hooks";

/* #972 — the site-wide banner an operator sets from the admin panel. It shows
   for every user; this component is mounted in the authenticated app shell, and
   the hook polls the public endpoint so a banner appears within about a minute
   of being set, without a reload. An empty message means no banner, so this
   renders nothing. */

const TONE: Record<"info" | "warning" | "critical", string> = {
  info: "bg-wash-teal border-teal/40 text-ink-1",
  warning: "bg-wash-warn border-amber/50 text-ink-1",
  critical: "bg-wash-bad border-bad/60 text-ink-1",
};

export function PlatformBanner() {
  const { data } = usePlatformBanner();
  const message = data?.message?.trim();
  if (!message) return null;

  const level = data!.level;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="platform-banner"
      data-level={level}
      className={cn("border-b px-[14px] sm:px-[22px] py-2 text-[13px] text-center", TONE[level])}
    >
      {message}
    </div>
  );
}
