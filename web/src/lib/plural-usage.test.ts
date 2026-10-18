import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * #793 — every "<n> <noun>" shown in the UI goes through plural() in
 * ./plural.ts. This greps the web source for the two hand-written shapes that
 * produced "1 links across 1 domains":
 *
 *   1. an interpolation directly followed by a plural noun:  `${n} links`, {n} rules
 *   2. a hand-rolled suffix:                                   link${n === 1 ? "" : "s"}
 *
 * If a line below is a genuine non-count (a name that happens to end in a
 * plural noun), add it to ALLOWED with the reason. Do not add a count.
 */

const SRC = join(__dirname, "..");

const NOUNS = [
  "links", "domains", "rules", "members", "invites", "invitations", "clicks", "tags", "visits", "keys",
  "tokens", "devices", "sessions", "rows", "items", "seats", "results", "destinations", "entries", "events",
  "workspaces", "users", "codes", "days", "hours", "minutes", "months", "years", "attempts", "redirects",
  "folders", "views", "errors", "failures", "requests", "scans", "countries", "referrers", "records",
  "emails", "recipients", "steps", "options", "changes", "reports", "campaigns", "projects", "files", "pages",
  "lines", "characters", "fields", "webhooks", "pages", "cities",
];

// `(?!=)` skips a JSX prop that happens to be named like a noun (`} options={…}`).
const INTERPOLATED_PLURAL = new RegExp(`\\}\\s*(?:${NOUNS.join("|")})\\b(?!=)`);
const SUFFIX_TERNARY = /\?\s*(?:""|''|``)\s*:\s*["'`]s["'`]|===\s*1\s*\?\s*["'`][^"'`]*["'`]\s*:\s*`\$\{/;

/** `relative/path:line-content-trimmed` → why it is not a count. */
const ALLOWED: Record<string, string> = {
  "components/forms/form-drawer.tsx:Field {n} options":
    "a label naming the 'options' textarea of field number n, not a count of options",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const IGNORED_FILES = new Set([
  ["lib", "plural.ts"].join(sep),
  // Demo data: fixture strings that mirror what the API sends.
  ["lib", "api", "fixtures.ts"].join(sep),
  ["lib", "api", "openapi.generated.json"].join(sep),
]);

function offenders(): string[] {
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    if (IGNORED_FILES.has(rel)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (INTERPOLATED_PLURAL.test(code) || SUFFIX_TERNARY.test(code)) {
          const key = `${rel.split(sep).join("/")}:${code}`;
          if (!(key in ALLOWED)) hits.push(`${rel}:${i + 1}  ${code}`);
        }
      });
  }
  return hits;
}

describe("no hard-coded '<n> <plural noun>' strings in web/src (#793)", () => {
  it("scans a non-trivial number of source files", () => {
    expect(walk(SRC).length).toBeGreaterThan(50);
  });

  it("the patterns catch the shapes that shipped", () => {
    expect(INTERPOLATED_PLURAL.test("`${full(data.total)} links across`")).toBe(true);
    expect(INTERPOLATED_PLURAL.test("<Chip>{l.rules.length} rules</Chip>")).toBe(true);
    expect(SUFFIX_TERNARY.test('`${days} day${days === 1 ? "" : "s"} ago`')).toBe(true);
    expect(SUFFIX_TERNARY.test('count === 1 ? "1 record to add" : `${count} records to add`')).toBe(true);
    expect(INTERPOLATED_PLURAL.test("`${plural(n, 'link')} across`")).toBe(false);
  });

  it("every count goes through plural()", () => {
    expect(offenders()).toEqual([]);
  });
});
