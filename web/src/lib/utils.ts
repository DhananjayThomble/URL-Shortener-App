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

/** Shown wherever a percentage has nothing meaningful to be computed from. */
export const NO_VALUE = "—";

/**
 * `num / den` as a percentage string, or a dash when the denominator is zero
 * (or not a finite number). Never "NaN%" / "Infinity%".
 */
export function ratioPct(num: number, den: number, digits = 1): string {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return NO_VALUE;
  return pct((num / den) * 100, digits);
}

/**
 * Fraction of the previous funnel step that did not make it to this one, as a
 * percentage. null when the previous step is zero (or either value is not a
 * finite number): there was nothing to drop off from. A negative result means
 * this step is larger than the previous one.
 */
export function dropOff(prev: number, curr: number): number | null {
  if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0) return null;
  return (1 - curr / prev) * 100;
}

/** The funnel's between-steps caption. A dash, never NaN/Infinity, for a zero previous step. */
export function dropOffLabel(prev: number, curr: number): string {
  const drop = dropOff(prev, curr);
  if (drop === null) return `${NO_VALUE} drop off`;
  if (drop < 0) return `▲ ${pct(Math.abs(drop))} more than the step before`;
  return `▼ ${pct(drop)} drop off`;
}

/**
 * A period-over-period change as it should be shown on a tile.
 *
 * One rule for every tile: if there is no comparison to make (the API sends
 * null for a zero baseline, or the change is exactly zero) show a dash with a
 * neutral tone — no arrow, because there is no direction. Otherwise show the
 * signed magnitude with an arrow that matches the sign.
 */
export function formatDelta(delta: number | null | undefined): { text: string; tone: "up" | "down" | "flat" } {
  if (delta === null || delta === undefined || !Number.isFinite(delta) || pct(Math.abs(delta)) === "0.0%") {
    return { text: NO_VALUE, tone: "flat" };
  }
  return delta > 0
    ? { text: `▲ ${pct(delta)}`, tone: "up" }
    : { text: `▼ ${pct(Math.abs(delta))}`, tone: "down" };
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

/* Human-relative time for an API timestamp. Unlike relativeDate it (a) clamps a
   timestamp slightly in the future (browser/server clock skew, e.g. an invite
   sent a moment ago) to "just now" instead of "-3 min ago", and (b) passes
   anything that is not an ISO-8601 timestamp (fixture strings such as "12 min
   ago") through untouched rather than letting Date's lenient parser guess. */
export function timeAgo(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso)) return iso;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  if (then >= Date.now() - 60_000) return "just now";
  return relativeDate(iso);
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
