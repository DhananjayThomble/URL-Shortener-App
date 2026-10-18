import type { Domain, Member } from "@snapurl/contract";

// Same as utils.full; not imported from there because utils.ts uses plural().
const group = (n: number) => n.toLocaleString();

/*
 * #793 — one place that turns a number and a noun into "1 link" / "2 links".
 *
 * Every count shown in the UI goes through here instead of a hand-written
 * `${n} links` template, which is how "1 links across 1 domains" shipped.
 * `plural-usage.test.ts` fails the build if a hard-coded `<n> <plural noun>`
 * pattern creeps back into web/src.
 */

const RULES = new Intl.PluralRules("en-US");

export interface PluralOptions {
  /** Irregular plural ("country" → "countries"). Defaults to `${singular}s`. */
  plural?: string;
  /** How the number is written. Defaults to grouped digits ("2,431"). */
  format?: (n: number) => string;
}

/** The noun alone, agreeing with `n`: pluralNoun(1, "link") → "link". */
export function pluralNoun(n: number, singular: string, plural: string = `${singular}s`): string {
  return RULES.select(Math.abs(n)) === "one" ? singular : plural;
}

/** The number and its noun: plural(1, "link") → "1 link", plural(2431, "link") → "2,431 links". */
export function plural(n: number, singular: string, opts: PluralOptions = {}): string {
  const fmt = opts.format ?? group;
  return `${fmt(n)} ${pluralNoun(n, singular, opts.plural)}`;
}

/** "has" / "have" for a count, for sentences that start with one ("3 rows have …"). */
export function hasHave(n: number): "has" | "have" {
  return RULES.select(Math.abs(n)) === "one" ? "has" : "have";
}

/**
 * Members split into people who can act in the workspace and invitations that
 * have not been accepted. A pending invite is not a member: it has no access,
 * no activity and no 2FA state, so it must not inflate "N members".
 */
export function memberCounts(members: readonly Pick<Member, "status">[] | undefined): {
  active: number;
  pending: number;
} {
  let pending = 0;
  for (const m of members ?? []) if (m.status === "invited") pending += 1;
  return { active: (members?.length ?? 0) - pending, pending };
}

/** "1 member", "3 members · 1 pending", "1 member · 2 pending". */
export function memberSummary(members: readonly Pick<Member, "status">[] | undefined): string {
  const { active, pending } = memberCounts(members);
  return pending > 0 ? `${plural(active, "member")} · ${pending} pending` : plural(active, "member");
}

/**
 * The domains "N domains" counts: those that are serving (live) or that still
 * hold links. A domain that is only waiting on DNS (verifying) and has no
 * links yet is not a domain you can use, so it does not count; one that failed
 * after links were attached to it still does, because those links exist.
 */
export function countedDomains<T extends Pick<Domain, "status" | "links">>(domains: readonly T[] | undefined): T[] {
  return (domains ?? []).filter((d) => d.status === "live" || d.links > 0);
}
