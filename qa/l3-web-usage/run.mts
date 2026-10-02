/*
 * L3 — web/ consumption vs. contract guarantee. See README.md.
 *
 * Oracle: the real, built `@snapurl/contract` zod schemas, introspected at
 * runtime (`.isOptional()` / `.isNullable()` / `.unwrap()`), reached via the
 * exact schema identifier each hook in web/src/lib/api/hooks/*.ts passes to
 * `request(path, Schema, ...)` — read literally from source, never re-typed
 * or guessed (steering §1.1).
 *
 * Every chain `web/` reads off a hook's result that passes through a field
 * the schema marks optional/nullable, without a guard this script can see,
 * is one line in .qa-runs/l3-web-usage/findings.jsonl. No verdicts (steering
 * §2) — a flagged chain may be guarded by control flow this static pass does
 * not model; that caveat travels in the finding's `notes`, not as a reason to
 * drop it.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../..");
const RUN_DIR = resolve(REPO_ROOT, ".qa-runs/l3-web-usage");
const FINDINGS_PATH = resolve(RUN_DIR, "findings.jsonl");
const SUMMARY_PATH = resolve(RUN_DIR, "summary.md");

mkdirSync(RUN_DIR, { recursive: true });
writeFileSync(FINDINGS_PATH, ""); // per-run report, not an accumulating log

// ---------------------------------------------------------------------------
// Oracle: the real contract package, loaded as actual zod schema objects.
// ---------------------------------------------------------------------------
const contractDist = resolve(REPO_ROOT, "packages/contract/dist/index.js");
let contract: Record<string, unknown>;
try {
  contract = await import(contractDist);
} catch (err) {
  console.error(
    `Could not load the built contract package at ${contractDist}. ` +
      `Run "pnpm --filter @snapurl/contract build" first.\n${err}`,
  );
  process.exit(1);
}

// Minimal structural typing for the zod internals this script introspects.
// Avoids importing zod's own types (version-sensitive) — just duck-types the
// handful of methods zod 4 objects/optionals/nullables/arrays expose.
interface ZSchema {
  isOptional?: () => boolean;
  isNullable?: () => boolean;
  unwrap?: () => ZSchema;
  shape?: Record<string, ZSchema>;
  element?: ZSchema; // ZodArray
  def?: { type?: string; options?: ZSchema[] }; // zod 4 internal def; `type` discriminates optional/nullable/default/etc.
}

/** Unwraps ZodOptional/ZodNullable/ZodDefault layers, returning the innermost schema. */
function unwrapAll(schema: ZSchema): ZSchema {
  let s = schema;
  const seen = new Set<ZSchema>();
  while (s?.unwrap && !seen.has(s)) {
    seen.add(s);
    const next = s.unwrap();
    if (!next) break;
    s = next;
  }
  return s;
}

/**
 * True if accessing this field directly (no guard) can read undefined/null
 * **on parsed output** — i.e. what `web/` actually receives out of
 * `schema.safeParse()` in client.ts, not what the schema accepts as input.
 *
 * zod 4's `.isOptional()` answers the input question: a `.default(x)`-wrapped
 * field reports `isOptional() === true` because the *input* may omit it, but
 * the *parsed output* `web/` reads is never undefined — zod fills the
 * default. Only `ZodOptional`/`ZodNullable` (def.type "optional"/"nullable")
 * represent a value that can genuinely still be absent after parsing; a
 * `.default()`/`.catch()` wrapper does not, so it is unwrapped by
 * `unwrapAll()` but never itself counted as loose.
 */
function isLooseField(schema: ZSchema): boolean {
  if (!schema?.def) return false;
  return schema.def.type === "optional" || schema.def.type === "nullable";
}

/**
 * Resolves a dotted path (e.g. "safeBrowsing.status" or "items.0.title" with
 * the index segment skipped by the caller) against a root zod object schema.
 * Returns, for each segment, whether that segment's schema is loose
 * (optional/nullable) — the caller decides whether the access was guarded.
 */
function resolvePath(root: ZSchema, path: string[]): { segment: string; loose: boolean; found: boolean }[] {
  const out: { segment: string; loose: boolean; found: boolean }[] = [];
  let current = unwrapAll(root);
  for (const seg of path) {
    if (!current) {
      out.push({ segment: seg, loose: false, found: false });
      continue;
    }
    // Arrays: a numeric/variable index just steps into .element, not a new field.
    if (current.element) {
      current = unwrapAll(current.element);
    }
    const shape = current?.shape;
    const field: ZSchema | undefined = shape?.[seg];
    if (!field) {
      out.push({ segment: seg, loose: false, found: false });
      current = undefined as unknown as ZSchema;
      continue;
    }
    const loose = isLooseField(field);
    out.push({ segment: seg, loose, found: true });
    current = unwrapAll(field);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 1: hook -> schema map, read literally from web/src/lib/api/hooks/*.ts
// ---------------------------------------------------------------------------
const HOOKS_DIR = resolve(REPO_ROOT, "web/src/lib/api/hooks");
const hooksFiles = ["analytics.ts", "auth.ts", "bio-pages.ts", "developers.ts", "domains.ts", "forms.ts", "links.ts", "members.ts", "public.ts", "reports.ts", "workspace.ts"].map(
  (f) => resolve(HOOKS_DIR, f),
);

interface HookInfo {
  name: string;
  schemaExpr: string; // source text of the schema argument, e.g. "Link" or "z.array(Form)"
  file: string;
  isQuery: boolean; // useQuery (result shape is { data, isLoading, ... }) vs useMutation
}

const hooks = new Map<string, HookInfo>();

function printer() {
  return ts.createPrinter({ removeComments: true });
}
const print = printer();

function textOf(node: ts.Node): string {
  return print.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
}

for (const file of hooksFiles) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const hookName = node.name.text;
      if (!hookName.startsWith("use")) {
        ts.forEachChild(node, visit);
        return;
      }
      let schemaExpr: string | null = null;
      let isQuery = false;

      const inner = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
          if (n.expression.text === "request" && n.arguments.length >= 2) {
            schemaExpr = textOf(n.arguments[1]);
          }
          if (n.expression.text === "useQuery") isQuery = true;
        }
        ts.forEachChild(n, inner);
      };
      inner(node.body);

      if (schemaExpr) {
        hooks.set(hookName, { name: hookName, schemaExpr, file, isQuery });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

console.log(`Mapped ${hooks.size} hooks to a contract schema.`);

/** Resolves a hook's schema source text (e.g. "z.array(Form)", "LinkList") to
 *  the actual root object schema to walk field accesses against. Collection
 *  wrappers (z.array(X), z.undefined()) are unwrapped to X or dropped. */
function rootSchemaFor(hook: HookInfo): ZSchema | null {
  const expr = hook.schemaExpr.trim();
  const arrayMatch = expr.match(/^z\.array\((\w+)\)$/);
  const name = arrayMatch ? arrayMatch[1] : expr;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null; // z.undefined(), inline z.object(...), etc. — not resolvable to a named export
  const schema = contract[name] as ZSchema | undefined;
  if (!schema || typeof schema.shape === "undefined") {
    // Could still be useful (e.g. a discriminated union or array-of-primitive);
    // only object schemas are walked here.
    return (schema as ZSchema) ?? null;
  }
  return schema;
}

// ---------------------------------------------------------------------------
// Step 2: find hook usages under web/src/app and web/src/components, and the
// property-access chains read off their result.
// ---------------------------------------------------------------------------
function listFiles(dir: string, out: string[] = []): string[] {
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts") && !e.name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

const consumerFiles = [...listFiles(resolve(REPO_ROOT, "web/src/app")), ...listFiles(resolve(REPO_ROOT, "web/src/components"))];

interface AccessChain {
  base: string; // the local variable name the chain is rooted at
  path: string[]; // property segments after the base, index segments represented as "[]"
  guardedAt: Set<number>; // path indices (0-based) that were accessed via optional chaining in source
  nonNullAssertedAt: Set<number>; // path indices reached via a `!` — silences TS, not a runtime guard
  nullishWrapped: boolean; // whole expression is inside a ?? or a?.b && ... guard immediately
  file: string;
  line: number;
  text: string;
}

const chains: AccessChain[] = [];

for (const file of consumerFiles) {
  const text = readFileSync(file, "utf8");
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);

  // Find `const <alias> = useX(...)` or `const { data: alias } = useX(...)`,
  // and plain `const alias = useX(...).data` forms, per-file (hook result
  // variables are not tracked across files/modules — out of scope for a
  // static pass with no type checker wired up).
  // alias -> { hookName, viaData: boolean (true if alias is already the .data } )
  const aliases = new Map<string, { hookName: string; viaData: boolean }>();

  const findDecls = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      let init = node.initializer;
      let viaDataSuffix = false;
      // const l = link.data
      if (ts.isPropertyAccessExpression(init) && init.name.text === "data" && ts.isIdentifier(init.expression)) {
        const callerVar = init.expression.text;
        // was `link` itself bound to a hook call earlier in this file?
        // (handled below once we know hook-call bindings)
        aliases.set("__datasrc__:" + node.name.getText(), { hookName: callerVar, viaData: true });
        viaDataSuffix = true;
      }
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && hooks.has(init.expression.text)) {
        const hookName = init.expression.text;
        if (ts.isIdentifier(node.name)) {
          aliases.set(node.name.text, { hookName, viaData: false });
        } else if (ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) {
              const propName = el.propertyName ? el.propertyName.getText() : el.name.text;
              if (propName === "data") aliases.set(el.name.text, { hookName, viaData: true });
            }
          }
        }
      }
      void viaDataSuffix;
    }
    ts.forEachChild(node, findDecls);
  };
  findDecls(source);

  // Resolve `__datasrc__:` indirections (const x = someVar.data, where
  // someVar was bound a few lines above to a hook call result).
  for (const [key, val] of [...aliases.entries()]) {
    if (key.startsWith("__datasrc__:")) {
      const aliasName = key.slice("__datasrc__:".length);
      const callerVar = val.hookName; // actually the variable name here
      const callerBinding = aliases.get(callerVar);
      aliases.delete(key);
      if (callerBinding) aliases.set(aliasName, { hookName: callerBinding.hookName, viaData: true });
    }
  }

  if (aliases.size === 0) continue;

  // Walk property-access chains rooted at a `.data`-bound alias.
  const dataAliases = new Map([...aliases.entries()].filter(([, v]) => v.viaData));
  if (dataAliases.size === 0) continue;

  const visitAccess = (node: ts.Node) => {
    const rootName = chainRootIdentifier(node);
    if (rootName && dataAliases.has(rootName) && isTopmostAccess(node)) {
      const { path, guardedAt, nonNullAssertedAt } = flattenChain(node);
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      chains.push({
        base: rootName,
        path,
        guardedAt,
        nonNullAssertedAt,
        nullishWrapped: isNullishGuarded(node),
        file,
        line: line + 1,
        text: node.getText().slice(0, 160),
      });
    }
    ts.forEachChild(node, visitAccess);
  };
  visitAccess(source);

  // Attach the hook name to each chain found in this file via closure state.
  for (const c of chains) {
    if (c.file === file && !("hookName" in c)) {
      const binding = dataAliases.get(c.base);
      if (binding) (c as unknown as { hookName: string }).hookName = binding.hookName;
    }
  }
}

/** Walks up from a PropertyAccess/ElementAccess to see if this is the
 *  outermost access in its chain (so a.b.c is visited once, not 3 times). */
function isTopmostAccess(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return false;
  if (ts.isElementAccessExpression(parent) && parent.expression === node) return false;
  if (ts.isNonNullExpression(parent) && parent.expression === node) return false;
  return true;
}

/** Returns the root identifier name of a (possibly optional) member-access
 *  chain, e.g. `a?.b.c` -> "a", or null if the chain's root is not a bare
 *  identifier (e.g. a function call result). */
function chainRootIdentifier(node: ts.Node): string | null {
  let n: ts.Node = node;
  while (true) {
    if (ts.isIdentifier(n)) return n.text;
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      n = n.expression;
      continue;
    }
    if (ts.isNonNullExpression(n)) {
      n = n.expression;
      continue;
    }
    return null;
  }
}

/** Flattens `base.a.b[0].c` into { path: ["a","b","[]","c"], guardedAt }, where
 *  guardedAt holds the 0-based index of every path segment reached through
 *  `?.` (optional chaining) rather than a plain `.`. */
function flattenChain(node: ts.Node): { path: string[]; guardedAt: Set<number>; nonNullAssertedAt: Set<number> } {
  const segs: { name: string; optional: boolean; nonNullAsserted: boolean }[] = [];
  let n: ts.Node = node;
  // Segments are discovered outside-in (rightmost first) but stored left-to-
  // right via unshift. A `!` guards nothing at runtime — it only silences
  // TypeScript's own optional/nullable check — so it is tracked separately
  // from a real guard (`?.`/`??`/`&&`) and does NOT suppress a finding: the
  // developer asserting "trust me" is exactly the case this script exists to
  // double-check against the oracle, not a reason to stay quiet.
  let pendingNonNull = false;
  while (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || ts.isNonNullExpression(n)) {
    if (ts.isPropertyAccessExpression(n)) {
      segs.unshift({ name: n.name.text, optional: Boolean(n.questionDotToken), nonNullAsserted: pendingNonNull });
      pendingNonNull = false;
      n = n.expression;
    } else if (ts.isElementAccessExpression(n)) {
      segs.unshift({ name: "[]", optional: Boolean(n.questionDotToken), nonNullAsserted: pendingNonNull });
      pendingNonNull = false;
      n = n.expression;
    } else {
      n = n.expression; // non-null assertion `!` on the expression immediately to its left
      pendingNonNull = true;
    }
  }
  const guardedAt = new Set<number>();
  const nonNullAssertedAt = new Set<number>();
  segs.forEach((s, i) => {
    if (s.optional) guardedAt.add(i);
    if (s.nonNullAsserted) nonNullAssertedAt.add(i);
  });
  return { path: segs.map((s) => s.name), guardedAt, nonNullAssertedAt };
}

/** True if this access expression sits directly inside a `?? …` or
 *  `… && base.a.b` guard, or a ternary testing the same base — a shallow,
 *  conservative check; anything it misses becomes a finding with the caveat
 *  noted (steering §2 — report it anyway). */
function isNullishGuarded(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
      return parent.right === node || parent.left === node;
    }
  }
  if (ts.isConditionalExpression(parent)) return parent.whenTrue === node;
  return false;
}

// ---------------------------------------------------------------------------
// Step 3: cross-check each chain against the schema and record findings.
// ---------------------------------------------------------------------------
interface Finding {
  id: string;
  layer: string;
  title: string;
  target: string;
  what_i_did: string;
  expected: string;
  observed: string;
  evidence: string[];
  repro: string;
  severity_hint: string;
  confidence: string;
  notes?: string;
}

function writeFinding(f: Finding): void {
  appendFileSync(FINDINGS_PATH, JSON.stringify(f) + "\n");
}

let chainsChecked = 0;
let chainsUnresolvable = 0;
let findingsCount = 0;
const seenFindingKeys = new Set<string>();
const perHookCoverage = new Map<string, number>();

for (const c of chains) {
  const hookName = (c as unknown as { hookName?: string }).hookName;
  if (!hookName) continue;
  const hook = hooks.get(hookName);
  if (!hook) continue;
  const root = rootSchemaFor(hook);
  if (!root || typeof root.shape === "undefined") {
    chainsUnresolvable++;
    continue;
  }
  chainsChecked++;
  perHookCoverage.set(hookName, (perHookCoverage.get(hookName) ?? 0) + 1);

  const pathForSchema = c.path.filter((s) => s !== "[]"); // index segments don't name a field
  const resolved = resolvePath(root, pathForSchema);

  // Find the first loose segment that was not guarded at its own index
  // (accounting for the "[]" segments shifting indices between `path` and
  // `pathForSchema`).
  let schemaIdx = 0;
  for (let i = 0; i < c.path.length; i++) {
    if (c.path[i] === "[]") continue;
    const r = resolved[schemaIdx];
    schemaIdx++;
    if (!r || !r.found) break;
    if (r.loose && !c.guardedAt.has(i) && !c.nullishWrapped) {
      const chainSoFar = c.path.slice(0, i + 1).join(".");
      const key = `${hookName}::${chainSoFar}`;
      if (seenFindingKeys.has(key)) break;
      seenFindingKeys.add(key);
      findingsCount++;
      const viaNonNull = c.nonNullAssertedAt.has(i);
      writeFinding({
        id: `l3-web-usage-unguarded-${hookName}-${chainSoFar.replace(/\./g, "-")}`,
        layer: "contract",
        title: `web/ reads ${c.base}.${chainSoFar} as if always present, but the contract schema marks it optional/nullable`,
        target: `${relative(REPO_ROOT, c.file)}:${c.line} (hook: ${hookName}, schema: ${hook.schemaExpr})`,
        what_i_did:
          `Mapped ${hookName} (web/src/lib/api/hooks/${relative(HOOKS_DIR, hook.file)}) to the schema it passes to ` +
          `request(): ${hook.schemaExpr}. Loaded that schema from the built @snapurl/contract and asked field ` +
          `"${chainSoFar}" (walking from the schema's root, on the parsed OUTPUT type — a .default()-wrapped ` +
          `field is not counted as loose here, only real ZodOptional/ZodNullable) whether it can still be ` +
          `undefined/null via zod's own def.type discriminator. Then statically found this read of ` +
          `${c.base}.${chainSoFar} in ${relative(REPO_ROOT, c.file)}:${c.line} and checked whether the source ` +
          `guards that segment with optional chaining (?.) or wraps the whole expression in ?? / && / a ternary.`,
        expected:
          `Oracle: packages/contract's zod schema for ${hook.schemaExpr} (the exact schema ${hookName} validates ` +
          `its response against in web/src/lib/api/client.ts). That schema marks "${chainSoFar}" optional and/or ` +
          `nullable on parsed output, so a real API response can legitimately omit it or send null.`,
        observed:
          `Source text: \`${c.text}\` — no optional-chaining/nullish guard found at the "${c.path[i]}" segment.` +
          (viaNonNull
            ? ` This access reaches the field through a non-null assertion (!), which silences TypeScript's own ` +
              `optional/nullable warning rather than guarding anything at runtime.`
            : ""),
        evidence: [],
        repro: `grep -n ${JSON.stringify(c.text.slice(0, 60))} ${relative(REPO_ROOT, c.file)}`,
        severity_hint: "unknown",
        confidence: "medium",
        notes:
          "Static, file-local pass: does not model an enclosing `if (x.field) { ... }` guard a few lines above " +
          "this access, nor cross-file narrowing, nor a sibling guard earlier in the same logical expression " +
          "(e.g. `a?.b && fn(a.b!)` — the `!` is on a different AST node than the `?.` check and this pass does " +
          "not currently connect them). A flagged chain may already be runtime-safe for a reason this script " +
          "cannot see — re-check the surrounding control flow before treating this as a live bug." +
          (viaNonNull
            ? " This specific instance is reached via `!` (non-null assertion) rather than a missing guard " +
              "entirely — worth checking whether an enclosing `&&`/early-return on the same base already makes " +
              "it safe, since `!` is often added right after such a check."
            : ""),
      });
      break;
    }
  }
}

console.log(`Checked ${chainsChecked} access chains across ${perHookCoverage.size} hooks; ${chainsUnresolvable} unresolvable; ${findingsCount} findings.`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const hookList = [...hooks.keys()].sort();
const coveredHooks = [...perHookCoverage.keys()].sort();
const uncoveredHooks = hookList.filter((h) => !coveredHooks.includes(h));

writeFileSync(
  SUMMARY_PATH,
  [
    "# L3 — web/ consumption vs. contract guarantee",
    "",
    `Run at ${new Date().toISOString()}.`,
    "",
    "## What ran",
    "",
    `- ${hooks.size} hooks mapped to a @snapurl/contract schema (read from web/src/lib/api/hooks/*.ts source).`,
    `- ${chains.length} property-access chains found rooted at a hook's \`.data\`.`,
    `- ${chainsChecked} chains checked against a resolvable object schema; ${chainsUnresolvable} skipped (schema not a named object export this script can walk — e.g. z.undefined(), a bare array of primitives).`,
    `- ${findingsCount} distinct unguarded-optional-field findings written to findings.jsonl.`,
    "",
    "## Coverage",
    "",
    `Hooks with at least one checked access chain in web/src/app or web/src/components (${coveredHooks.length}/${hookList.length}):`,
    ...coveredHooks.map((h) => `- ${h} (${perHookCoverage.get(h)} chain(s))`),
    "",
    "### Coverage gaps",
    "",
    `Hooks with zero statically-traced access chains (${uncoveredHooks.length}) — either unused outside hooks/, or ` +
      "consumed in a way this pass does not model (destructured deeper than one level, passed through a helper " +
      "function before the field access happens, or the result crosses a file this pass does not also scan):",
    ...uncoveredHooks.map((h) => `- ${h}`),
    "",
    "This pass does not model:",
    "- An enclosing `if (x.field) { use x.field.sub }` guard — only chain-local `?.`/`??`/`&&`/ternary guards.",
    "- Hook results passed as props into a child component before the field access happens.",
    "- Hook results destructured into further local variables more than one assignment away from the hook call.",
    "- TypeScript's own control-flow narrowing (e.g. an early `return` on `!x.field` a few statements above).",
    "",
    "None of the above make a flagged chain *not* a finding — they are reasons a flagged chain might turn out to " +
      "already be guarded by code this script cannot see, which is why every finding carries that caveat in " +
      "`notes` rather than being silently dropped (steering §2).",
  ].join("\n") + "\n",
);

console.log(`Findings: ${FINDINGS_PATH}`);
console.log(`Summary: ${SUMMARY_PATH}`);
process.exit(findingsCount > 0 ? 1 : 0);
