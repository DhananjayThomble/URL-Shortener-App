import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 84392 -> "84.4k". Keeps table columns narrow without losing the sense of scale. */
export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export const full = (n: number) => n.toLocaleString();

/** Indian-format currency, which is what the workspace fixtures use. */
export function inr(paise: number): string {
  if (paise >= 10_000_000) return `₹${(paise / 10_000_000).toFixed(1)}Cr`;
  if (paise >= 100_000) return `₹${(paise / 100_000).toFixed(1)}L`;
  return `₹${paise.toLocaleString("en-IN")}`;
}

export function pct(n: number, digits = 1): string {
  return `${n > 0 ? "" : ""}${n.toFixed(digits)}%`;
}

export function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours} hour${Math.abs(hours) === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 31) return `${days} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return `${months} month${Math.abs(months) === 1 ? "" : "s"} ago`;
  return `${Math.round(months / 12)} year${Math.abs(months) >= 24 ? "s" : ""} ago`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function shortUrl(domain: string, slug: string) {
  return `${domain}/${slug}`;
}

/** Clipboard is unavailable on http:// origins and in some webviews. */
export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function faviconFor(destination: string): string {
  try {
    const host = new URL(destination).hostname.replace("www.", "");
    const map: Record<string, string> = {
      "acme.com": "🛍",
      "apps.apple.com": "📱",
      "play.google.com": "🤖",
      "calendly.com": "🗓",
    };
    return map[host] ?? "🔗";
  } catch {
    return "🔗";
  }
}
