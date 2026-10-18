import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, describeAuditAction, humaniseAuditKey } from "@snapurl/domain";

/* ============================================================
   #783 — every audit key this API writes must have human copy.

   Enforced by the COMPILER, not by a source scan: `audit_log.action` is typed
   `$type<AuditAction>()` in @snapurl/database, and writeAuditEntry,
   auditInTransaction, recordActivity and MembersService.writeAudit all take
   AuditAction. So every way TypeScript can spell a write — double or single
   quotes, a line-broken property, a shorthand `{ action }` from a variable, a
   ternary, a raw insert(auditLog) — is checked by tsc against the closed set
   that has a label. (The #783 review showed the earlier regex scan missed the
   single-quoted, shorthand and multiline forms.)

   This file PROVES that claim: it compiles probe sources against the API's
   real tsconfig and real package types, and asserts each unlisted-key form is
   a type error while the same form with a listed key compiles clean (so the
   proof cannot pass vacuously). The one path tsc cannot see — a raw SQL
   `insert into audit_log` — is refused outright by a scan below.
   ============================================================ */

const API_SRC = join(__dirname, "..");
const API_ROOT = join(API_SRC, "..");

/* ---------- compiler proof ---------- */

const PRELUDE = `
import { auditLog, writeAuditEntry, type Database } from "@snapurl/database";
import { auditInTransaction, recordActivity, type Actor } from "./common/activity.js";
import { MembersService } from "./members/members.service.js";
declare const db: Database;
declare const actor: Actor;
declare const members: MembersService;
declare const cond: boolean;
declare const logger: any;
const workspaceId = "w";
const actorLabel = "a";
export {};
`;

/** One way of writing an audit action, with `KEY` where the key goes. */
const FORMS: Record<string, string> = {
  "raw insert, double quotes": `void db.insert(auditLog).values({ workspaceId, actorLabel, action: "KEY" });`,
  "raw insert, single quotes": `void db.insert(auditLog).values({ workspaceId, actorLabel, action: 'KEY' });`,
  "raw insert, value on the next line": `void db.insert(auditLog).values({
  workspaceId,
  actorLabel,
  action:
    "KEY",
});`,
  "raw insert, shorthand from a const": `const action = "KEY";
void db.insert(auditLog).values({ workspaceId, actorLabel, action });`,
  "raw insert, ternary": `void db.insert(auditLog).values({ workspaceId, actorLabel, action: cond ? "member.invited" : 'KEY' });`,
  "raw insert, array of rows": `void db.insert(auditLog).values([{ workspaceId, actorLabel, action: "member.invited" }, { workspaceId, actorLabel, action: 'KEY' }]);`,
  "writeAuditEntry, single quotes, multiline": `void writeAuditEntry(db, {
  workspaceId,
  actorId: null,
  actorLabel,
  action:
    'KEY',
});`,
  "auditInTransaction, shorthand": `const auditAction = "KEY";
void auditInTransaction(db, { workspaceId, actor, auditAction });`,
  "recordActivity, single quotes": `void recordActivity(db, logger, { workspaceId, actor, auditAction: 'KEY' });`,
  "MembersService.writeAudit, positional": `void members.writeAudit(db, workspaceId, null, actorLabel, 'KEY');`,
};

const UNLISTED = "workspace.renamed";
const LISTED = "member.invited";

function compileProbes(probes: Record<string, string>): Map<string, readonly ts.Diagnostic[]> {
  const configPath = join(API_ROOT, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, { noEmit: true }, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  });
  if (!parsed) throw new Error("could not read apps/api/tsconfig.json");

  // Virtual files that live in apps/api/src, so they resolve imports exactly
  // as the API's own sources do.
  const virtual = new Map<string, string>();
  for (const [name, body] of Object.entries(probes)) {
    virtual.set(join(API_SRC, `__audit_probe_${name}__.ts`), `${PRELUDE}\n${body}\n`);
  }

  const host = ts.createCompilerHost(parsed.options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.fileExists = (f) => virtual.has(f) || fileExists(f);
  host.readFile = (f) => virtual.get(f) ?? readFile(f);
  host.getSourceFile = (f, lang, onError, create) => {
    const text = virtual.get(f);
    return text !== undefined ? ts.createSourceFile(f, text, lang, true) : getSourceFile(f, lang, onError, create);
  };

  const program = ts.createProgram({ rootNames: [...virtual.keys()], options: parsed.options, host });
  const out = new Map<string, readonly ts.Diagnostic[]>();
  for (const [path] of virtual) {
    const name = path.slice(join(API_SRC, "__audit_probe_").length, -"__.ts".length);
    const sf = program.getSourceFile(path)!;
    out.set(name, [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]);
  }
  return out;
}

const text = (ds: readonly ts.Diagnostic[]) => ds.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("\n");

describe("the compiler refuses an audit key with no human copy (#783)", () => {
  const probes: Record<string, string> = {};
  for (const [form, body] of Object.entries(FORMS)) {
    probes[`bad ${form}`] = body.replaceAll("KEY", UNLISTED);
    probes[`ok ${form}`] = body.replaceAll("KEY", LISTED);
  }
  // A key that is only known to be `string` (a widened let, a request field)
  // is refused even when its value happens to be listed.
  probes["string"] = `let action = "${LISTED}";
action = action.trim();
void db.insert(auditLog).values({ workspaceId, actorLabel, action });`;
  // Built once: a TypeScript program over the API's types takes a few seconds.
  let results: Map<string, readonly ts.Diagnostic[]>;
  const results$ = () => (results ??= compileProbes(probes));

  it("the unlisted probe key really is unlisted", () => {
    expect(AUDIT_ACTIONS as readonly string[]).not.toContain(UNLISTED);
    expect(AUDIT_ACTIONS as readonly string[]).toContain(LISTED);
  });

  for (const form of Object.keys(FORMS)) {
    it(`${form}: an unlisted key is a type error, a listed one compiles`, { timeout: 120_000 }, () => {
      const r = results$();
      const ok = r.get(`ok ${form}`)!;
      expect(text(ok), "the control (listed key) must compile clean").toBe("");
      const bad = r.get(`bad ${form}`)!;
      expect(bad.length, `an unlisted key written as "${form}" compiled`).toBeGreaterThan(0);
      expect(text(bad)).toMatch(/not assignable/);
    });
  }

  it("a key typed only as string is a type error, even with a listed value", { timeout: 120_000 }, () => {
    expect(text(results$().get("string")!)).toMatch(/not assignable/);
  });
});

/* ---------- source checks ---------- */

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.includes("test-harness") ? [path] : [];
  });
}

/** Every string literal in a file, however it is quoted or wrapped. */
function stringLiterals(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const SEED = join(API_ROOT, "..", "..", "packages", "database", "scripts", "seed.ts");

describe("audit actions in the API's sources (#783)", () => {
  it("no source writes audit_log through raw SQL, which tsc cannot type-check", () => {
    const raw = sources(API_SRC).filter((f) => /insert\s+into\s+"?audit_log"?/i.test(readFileSync(f, "utf8")));
    expect(raw.map((f) => relative(API_SRC, f))).toEqual([]);
  });

  it("every listed action has its own human label", () => {
    for (const key of AUDIT_ACTIONS) {
      const copy = describeAuditAction(key, {});
      expect(copy).not.toBe(key);
      expect(copy).not.toBe(humaniseAuditKey(key));
    }
  });

  it("every listed action is actually written somewhere (no dead copy)", () => {
    const seen = new Set<string>();
    for (const f of [...sources(API_SRC), SEED]) for (const s of stringLiterals(f)) seen.add(s);
    expect(AUDIT_ACTIONS.filter((a) => !seen.has(a))).toEqual([]);
  });
});
