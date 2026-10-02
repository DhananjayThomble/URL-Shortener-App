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
 *
 * Evidence lifecycle (steering §3): summary.md is written with a pending
 * section per phase BEFORE any check runs, progress.md gets one appended
 * line per completed phase, and findings.jsonl is appended to incrementally
 * as each finding is confirmed — never buffered in memory to flush at the
 * end. If a later phase throws, everything written by earlier phases is
 * already on disk.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { chainRootIdentifier, flattenChain, isGuardedAt, isTopmostAccess, resolvePath, type ZSchema } from "./analyzer.mts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../..");
const RUN_DIR = resolve(REPO_ROOT, ".qa-runs/l3-web-usage");
const FINDINGS_PATH = resolve(RUN_DIR, "findings.jsonl");
const SUMMARY_PATH = resolve(RUN_DIR, "summary.md");
const PROGRESS_PATH = resolve(RUN_DIR, "progress.md");

mkdirSync(RUN_DIR, { recursive: true });
writeFileSync(FINDINGS_PATH, ""); // per-run report, not an accumulating log
writeFileSync(PROGRESS_PATH, `# L3 — web/ consumption vs. contract guarantee — progress log\n\nRun started ${new Date().toISOString()}.\n\n`);

function logProgress(phase: string, detail: string): void {
  appendFileSync(PROGRESS_PATH, `- ${new Date().toISOString()} — ${phase}: ${detail}\n`);
}

// ---------------------------------------------------------------------------
// Phase 0: write the planned summary BEFORE any check runs (steering §3.1).
// ---------------------------------------------------------------------------
const PHASES = [
  "load-contract — load the built @snapurl/contract package",
  "map-hooks — map web/src/lib/api/hooks/*.ts hooks to their contract schema",
  "walk-chains — find property-access chains rooted at a hook's .data in web/src/app and web/src/components",
  "check-chains — cross-check each chain's loose segments against the oracle and record findings",
] as const;
type PhaseStatus = "pending" | "done" | "failed";
const phaseStatus = new Map<string, PhaseStatus>(PHASES.map((p) => [p, "pending" as PhaseStatus]));
const phaseResult = new Map<string, string>();

function writeSummary(): void {
  const lines: string[] = [
    "# L3 — web/ consumption vs. contract guarantee",
    "",
    `Last updated ${new Date().toISOString()}.`,
    "",
    "## Plan",
    "",
    "No staging stack needed — reads source files and the built contract package only.",
    "",
    "## Phases",
    "",
  ];
  for (const p of PHASES) {
    const status = phaseStatus.get(p);
    lines.push(`- [${status === "done" ? "x" : status === "failed" ? "!" : " "}] ${p}`);
    const result = phaseResult.get(p);
    if (result) lines.push(`  - ${result}`);
  }
  lines.push("", "## Coverage gaps", "", phaseStatus.get(PHASES[3]) === "done" ? "See below." : "Pending — not reached yet.", "");
  writeFileSync(SUMMARY_PATH, lines.join("\n") + "\n");
}
writeSummary();
logProgress("plan", "summary.md written with all phases pending");

// ---------------------------------------------------------------------------
// Phase 1: Oracle — the real contract package, loaded as actual zod schema objects.
// ---------------------------------------------------------------------------
const contractDist = resolve(REPO_ROOT, "packages/contract/dist/index.js");
let contract: Record<string, unknown>;
try {
  contract = await import(contractDist);
  phaseStatus.set(PHASES[0], "done");
  phaseResult.set(PHASES[0], `Loaded ${contractDist}.`);
  logProgress(PHASES[0], "loaded");
} catch (err) {
  phaseStatus.set(PHASES[0], "failed");
  phaseResult.set(PHASES[0], `Could not load ${contractDist}: ${err}`);
  logProgress(PHASES[0], `FAILED: ${err}`);
  writeSummary();
  console.error(
    `Could not load the built contract package at ${contractDist}. ` +
      `Run "pnpm --filter @snapurl/contract build" first.\n${err}`,
  );
  process.exit(1);
}
writeSummary();

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

try {
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
  phaseStatus.set(PHASES[1], "done");
  phaseResult.set(PHASES[1], `Mapped ${hooks.size} hooks to a contract schema.`);
  logProgress(PHASES[1], `${hooks.size} hooks mapped`);
} catch (err) {
  phaseStatus.set(PHASES[1], "failed");
  phaseResult.set(PHASES[1], `${err}`);
  logProgress(PHASES[1], `FAILED: ${err}`);
  writeSummary();
  throw err;
}
writeSummary();

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
  node: ts.Node; // the AST node for this chain — needed for per-segment isGuardedAt() checks
  file: string;
  line: number;
  text: string;
}

const chains: AccessChain[] = [];

try {
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
        const init = node.initializer;
        // const l = link.data
        if (ts.isPropertyAccessExpression(init) && init.name.text === "data" && ts.isIdentifier(init.expression)) {
          const callerVar = init.expression.text;
          // was `link` itself bound to a hook call earlier in this file?
          // (handled below once we know hook-call bindings)
          aliases.set("__datasrc__:" + node.name.getText(), { hookName: callerVar, viaData: true });
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

    const fileChains: AccessChain[] = [];
    const visitAccess = (node: ts.Node) => {
      const rootName = chainRootIdentifier(node);
      if (rootName && dataAliases.has(rootName) && isTopmostAccess(node)) {
        const { path, guardedAt, nonNullAssertedAt } = flattenChain(node);
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        fileChains.push({
          base: rootName,
          path,
          guardedAt,
          nonNullAssertedAt,
          node,
          file,
          line: line + 1,
          text: node.getText().slice(0, 160),
        });
      }
      ts.forEachChild(node, visitAccess);
    };
    visitAccess(source);

    // Attach the hook name to each chain found in this file.
    for (const c of fileChains) {
      const binding = dataAliases.get(c.base);
      if (binding) (c as unknown as { hookName: string }).hookName = binding.hookName;
    }
    chains.push(...fileChains);
  }
  phaseStatus.set(PHASES[2], "done");
  phaseResult.set(PHASES[2], `${chains.length} access chains found across ${consumerFiles.length} consumer files.`);
  logProgress(PHASES[2], `${chains.length} chains found`);
} catch (err) {
  phaseStatus.set(PHASES[2], "failed");
  phaseResult.set(PHASES[2], `${err}`);
  logProgress(PHASES[2], `FAILED: ${err}`);
  writeSummary();
  throw err;
}
writeSummary();

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

try {
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
      if (r.loose && !c.guardedAt.has(i) && !isGuardedAt(c.node, c.base, c.path, i)) {
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
            `guards that segment with optional chaining (?.), wraps the whole expression in ?? / && / a ternary, ` +
            `uses it only as a truthiness/equality test, or has an earlier sibling && test of the same path.`,
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
            "this access, cross-file narrowing, hook results passed through props/helpers, or TypeScript's own " +
            "control-flow narrowing from an early return. A flagged chain may already be runtime-safe for a " +
            "reason this script cannot see — re-check the surrounding control flow before treating this as a " +
            "live bug." +
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
  phaseStatus.set(PHASES[3], "done");
  phaseResult.set(PHASES[3], `${chainsChecked} chains checked, ${chainsUnresolvable} unresolvable, ${findingsCount} findings.`);
  logProgress(PHASES[3], `${findingsCount} findings`);
} catch (err) {
  phaseStatus.set(PHASES[3], "failed");
  phaseResult.set(PHASES[3], `${err}`);
  logProgress(PHASES[3], `FAILED: ${err}`);
  writeSummary();
  throw err;
}

console.log(`Checked ${chainsChecked} access chains across ${perHookCoverage.size} hooks; ${chainsUnresolvable} unresolvable; ${findingsCount} findings.`);

// ---------------------------------------------------------------------------
// Final summary (coverage detail only — phase status was already live-updated).
// ---------------------------------------------------------------------------
const hookList = [...hooks.keys()].sort();
const coveredHooks = [...perHookCoverage.keys()].sort();
const uncoveredHooks = hookList.filter((h) => !coveredHooks.includes(h));

writeFileSync(
  SUMMARY_PATH,
  [
    "# L3 — web/ consumption vs. contract guarantee",
    "",
    `Run completed ${new Date().toISOString()}.`,
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
    "- An enclosing `if (x.field) { use x.field.sub }` guard — only chain-local `?.`/`??`/`&&`/ternary/truthiness-test guards.",
    "- Hook results passed as props into a child component before the field access happens.",
    "- Hook results destructured into further local variables more than one assignment away from the hook call.",
    "- TypeScript's own control-flow narrowing (e.g. an early `return` on `!x.field` a few statements above).",
    "",
    "None of the above make a flagged chain *not* a finding — they are reasons a flagged chain might turn out to " +
      "already be guarded by code this script cannot see, which is why every finding carries that caveat in " +
      "`notes` rather than being silently dropped (steering §2).",
  ].join("\n") + "\n",
);
logProgress("summary", "final summary.md written");

console.log(`Findings: ${FINDINGS_PATH}`);
console.log(`Summary: ${SUMMARY_PATH}`);
console.log(`Progress: ${PROGRESS_PATH}`);
process.exit(findingsCount > 0 ? 1 : 0);
