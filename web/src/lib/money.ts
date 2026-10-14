import type { ConversionsReport, MemberRole } from "@snapurl/contract";
import { inr } from "./utils";

/* #654 — G7: revenue counts only conversions in the workspace currency and
   nothing is converted. The pieces below make that rule visible: money in the
   workspace's own currency (the page used to hard-code ₹), the "N conversions
   were not counted" sentence, and the choices offered in Settings. */

type Excluded = ConversionsReport["excluded"];
type ExcludedEntry = Excluded["byCurrency"][number];

/** Money in a currency's own symbol. INR keeps the existing Indian lakh/crore
 *  formatting; everything else uses Intl. An unknown code never throws on a
 *  render path: it falls back to "CODE amount". */
export function formatMoney(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  if (code === "INR") return inr(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toLocaleString("en-US")}`;
  }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "2 conversions in other currencies (USD) were not counted in revenue." —
 *  or null when nothing was excluded, so the page renders nothing at all. */
export function excludedNotice(excluded: Excluded): string | null {
  if (excluded.count <= 0) return null;
  const codes = excluded.byCurrency.map((c) => c.currency).join(", ");
  const n = excluded.count.toLocaleString("en-US");
  return excluded.count === 1
    ? `${n} conversion in another currency (${codes}) was not counted in revenue.`
    : `${n} conversions in other currencies (${codes}) were not counted in revenue.`;
}

/** One breakdown row: "USD · 2 conversions · $59" (valueMinor is minor units). */
export function excludedLine(entry: ExcludedEntry): string {
  const what = plural(entry.count, "conversion", "conversions");
  return `${entry.currency} · ${entry.count.toLocaleString("en-US")} ${what} · ${formatMoney(entry.valueMinor / 100, entry.currency)}`;
}

/* Two-decimal currencies only. The API turns minor units into major units by
   dividing by 100 everywhere (minorToMajor), so a zero-decimal currency such
   as JPY or KRW would be reported 100x too small. Not offered until that is
   currency-aware. */
export const WORKSPACE_CURRENCIES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "SGD",
  "AED",
  "CHF",
  "NZD",
  "ZAR",
  "BRL",
  "MXN",
] as const;

/** Select options for the Settings currency control. The workspace's current
 *  currency is always present, even if it is not in the list (it may have been
 *  set through the API), so the select never displays a value that is not the
 *  stored one. */
export function currencyOptions(current: string): { value: string; label: string }[] {
  const cur = current.toUpperCase();
  const codes: string[] = [...WORKSPACE_CURRENCIES];
  if (cur && !codes.includes(cur)) codes.push(cur);
  return codes.map((code) => ({ value: code, label: `${code} · ${symbolOf(code)}` }));
}

function symbolOf(code: string): string {
  try {
    const part = new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? code;
  } catch {
    return code;
  }
}

/** Whether the caller's role may change the workspace currency. Mirrors the API
 *  gate on PATCH /workspaces/current (@Roles("admin") = admin or owner); the API
 *  stays authoritative, this only stops offering a control that would 403.
 *  Unknown role (still loading) = not offered. */
export function canChangeWorkspaceCurrency(role: MemberRole | undefined): boolean {
  return role === "owner" || role === "admin";
}
