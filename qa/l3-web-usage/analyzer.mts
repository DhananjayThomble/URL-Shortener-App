/*
 * Pure AST-analysis helpers for qa/l3-web-usage. Extracted out of run.mts so
 * selftest.mts can exercise the guard logic directly against small fixtures
 * without needing a built @snapurl/contract package or the real web/ tree —
 * that's what makes the regression coverage in README's "Regression tests"
 * section possible without duplicating the detection logic.
 *
 * No I/O here, no process.exit, no contract/hooks-dir knowledge — just
 * TypeScript-AST-in, guard-decision-out.
 */
import ts from "typescript";

// ---------------------------------------------------------------------------
// Zod schema introspection (the oracle side).
// ---------------------------------------------------------------------------

// Minimal structural typing for the zod internals this script introspects.
// Avoids importing zod's own types (version-sensitive) — just duck-types the
// handful of methods zod 4 objects/optionals/nullables/arrays expose.
export interface ZSchema {
  isOptional?: () => boolean;
  isNullable?: () => boolean;
  unwrap?: () => ZSchema;
  shape?: Record<string, ZSchema>;
  element?: ZSchema; // ZodArray
  def?: { type?: string; options?: ZSchema[] }; // zod 4 internal def; `type` discriminates optional/nullable/default/etc.
}

/** Unwraps ZodOptional/ZodNullable/ZodDefault layers, returning the innermost schema. */
export function unwrapAll(schema: ZSchema): ZSchema {
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
export function isLooseField(schema: ZSchema): boolean {
  if (!schema?.def) return false;
  return schema.def.type === "optional" || schema.def.type === "nullable";
}

/**
 * Resolves a dotted path (e.g. "safeBrowsing.status" or "items.0.title" with
 * the index segment skipped by the caller) against a root zod object schema.
 * Returns, for each segment, whether that segment's schema is loose
 * (optional/nullable) — the caller decides whether the access was guarded.
 */
export function resolvePath(root: ZSchema, path: string[]): { segment: string; loose: boolean; found: boolean }[] {
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
// Source-side chain walking and guard detection.
// ---------------------------------------------------------------------------

/** Walks up from a PropertyAccess/ElementAccess to see if this is the
 *  outermost access in its chain (so a.b.c is visited once, not 3 times). */
export function isTopmostAccess(node: ts.Node): boolean {
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
export function chainRootIdentifier(node: ts.Node): string | null {
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
export function flattenChain(node: ts.Node): { path: string[]; guardedAt: Set<number>; nonNullAssertedAt: Set<number> } {
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
 *  `… && base.a.b` guard, or a ternary dereferencing the same base in its
 *  "when true" branch — a shallow, conservative check; anything it misses
 *  becomes a finding with the caveat noted (steering §2 — report it anyway). */
export function isNullishGuarded(node: ts.Node): boolean {
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

/**
 * True if this access is used purely as a truthiness/nullish test — the
 * condition of a ternary, the left operand of `&&`/`||`, the operand of a
 * `!`/`Boolean(...)` test, or either side of an `== null`/`=== undefined`
 * style comparison — rather than being dereferenced. Reading a possibly-
 * missing value just to test it can never throw, regardless of what the
 * contract schema says about that field, so this is never a loose-field
 * finding: `l.createdBy ? \`by ${l.createdBy}\` : ""` flags a false positive
 * on the *condition* otherwise, even though the only dereference of
 * `l.createdBy` in that expression is already behind the ternary it's the
 * condition of.
 */
export function isPureTruthinessTest(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isConditionalExpression(parent) && parent.condition === node) return true;
  if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) return true;
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "Boolean") return true;
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    const isEquality =
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    if (isEquality) return true;
    // The left operand of && / || is itself only tested for truthiness,
    // never dereferenced — distinct from isNullishGuarded's right-operand
    // case, which covers the branch that *does* dereference it.
    if ((op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) && parent.left === node) {
      return true;
    }
  }
  return false;
}

/**
 * Renders a flattened path back to dotted form for prefix comparison, e.g.
 * ["nextCursor"] -> "nextCursor", ["a","[]","b"] -> "a.[].b".
 */
export function pathKey(path: string[]): string {
  return path.join(".");
}

/**
 * True if `path` (or a prefix of it) was already tested truthy by an
 * earlier `&&` operand — or an earlier arm of the same optional-chaining
 * base — in an enclosing logical-AND chain or ternary condition, walking up
 * from `node`. Mirrors the short-circuit evaluation JS actually performs:
 * `data?.nextCursor && use(data.nextCursor!)` never evaluates the right
 * operand unless the left already proved `data.nextCursor` truthy, so the
 * right operand's read is guarded even though it carries no `?.` of its own.
 *
 * Only handles the same base identifier (`rootName`) — a guard on a
 * different variable does not prove anything about this one.
 */
export function isGuardedBySiblingTest(node: ts.Node, rootName: string, path: string[]): boolean {
  const targetKey = pathKey(path);
  const testedPrefixes = new Set<string>();

  const collectFromCondition = (cond: ts.Node) => {
    // A condition may itself be a chain of && (e.g. `a?.b && a.b.c`) —
    // collect every left-hand operand's tested path, not just the top one.
    const stack: ts.Node[] = [cond];
    while (stack.length) {
      const n = stack.pop()!;
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        stack.push(n.left, n.right);
        continue;
      }
      const root = chainRootIdentifier(n);
      if (root === rootName) {
        const { path: p } = flattenChain(n);
        testedPrefixes.add(pathKey(p));
      }
    }
  };

  let current: ts.Node = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.right === current) {
      collectFromCondition(parent.left);
    } else if (ts.isConditionalExpression(parent) && (parent.whenTrue === current || parent.condition === current)) {
      // whenTrue dereferences are already covered by isNullishGuarded; also
      // collect here so a chain of `a?.b ? use(a.b.c) : ...` style nesting
      // sees the same-base test regardless of which branch this walk is in.
      collectFromCondition(parent.condition);
    }
    current = parent;
  }

  // A tested prefix guards a longer path through it, e.g. testing
  // "nextCursor" guards "nextCursor" itself (exact) but not an unrelated
  // sibling field — only exact-path or true-prefix matches count.
  for (const prefix of testedPrefixes) {
    if (targetKey === prefix || targetKey.startsWith(prefix + ".")) return true;
  }
  return false;
}

/**
 * True if the chain rooted at `node` (its full path, e.g. ["safeBrowsing",
 * "status"]) is guarded, specifically for the segment at `targetIdx` within
 * that path (0-based). Two cases, deliberately kept separate because they
 * apply at different granularities:
 *
 * - Whole-chain truthiness/equality test (isNullishGuarded /
 *   isPureTruthinessTest): only proves the FULL chain's final value is
 *   safe to read as a boolean/compare — it says nothing about an
 *   intermediate loose segment. `l.safeBrowsing.status === "clean"` tests
 *   the final `.status` value, but if `safeBrowsing` itself is the loose
 *   segment, `l.safeBrowsing` is dereferenced (`.status` read off it)
 *   *before* the comparison runs — the equality test never protects a
 *   mid-chain segment. So this case only applies when `targetIdx` is the
 *   LAST segment of the path.
 * - Sibling `&&` test (isGuardedBySiblingTest): already prefix-aware — it
 *   compares the tested path against the path *up to and including*
 *   targetIdx, so it correctly guards a mid-chain segment too (testing
 *   `data?.nextCursor` guards a later bare `data.nextCursor` access,
 *   whether or not more of the chain follows).
 */
export function isGuardedAt(node: ts.Node, rootName: string, fullPath: string[], targetIdx: number): boolean {
  const isFinalSegment = targetIdx === fullPath.length - 1;
  if (isFinalSegment && (isNullishGuarded(node) || isPureTruthinessTest(node))) return true;
  const pathToTarget = fullPath.slice(0, targetIdx + 1);
  return isGuardedBySiblingTest(node, rootName, pathToTarget);
}

/**
 * True if this access chain is guarded by any mechanism this script
 * recognizes, for the LAST segment of its own path — the natural "is this
 * whole chain OK to read" question when no specific intermediate segment is
 * being asked about. Kept for call sites that don't need per-segment
 * granularity. See isGuardedAt for the segment-aware version run.mts's
 * finding loop actually uses.
 */
export function isGuarded(node: ts.Node, rootName: string, path: string[]): boolean {
  return isGuardedAt(node, rootName, path, path.length - 1);
}
