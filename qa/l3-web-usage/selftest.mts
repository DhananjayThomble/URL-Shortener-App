/*
 * Regression test for qa/l3-web-usage's guard analysis (analyzer.mts).
 * Required by the PR #635 review: a false positive on a guarded ternary
 * condition and a guarded && short-circuit were reported as findings
 * before this test existed. This locks the fix in and adds an unguarded
 * positive control so the check logic itself can't go silently too
 * permissive in the other direction.
 *
 * No contract package, no web/ tree, no hooks dir — exercises the pure AST
 * helpers in analyzer.mts directly against fixtures/consumer.fixture.tsx.
 *
 * Run: pnpm exec node --experimental-strip-types qa/l3-web-usage/selftest.mts
 * Exit code 0 = all assertions passed, non-zero = at least one regressed.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { chainRootIdentifier, flattenChain, isGuardedAt, isTopmostAccess } from "./analyzer.mts";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(here, "fixtures/consumer.fixture.tsx");

const text = readFileSync(FIXTURE_PATH, "utf8");
const source = ts.createSourceFile(FIXTURE_PATH, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/**
 * Finds every topmost property-access chain rooted at `baseName` whose
 * nearest preceding marker comment (a line matching `// CASE_...`) is
 * `marker`, in source order. Mirrors run.mts's own chain-collection logic
 * (chainRootIdentifier + isTopmostAccess) rather than reinventing it, so
 * this test exercises exactly what run.mts exercises.
 */
function findChainsAfterMarker(marker: string, baseName: string): ts.Node[] {
  const fullText = source.getFullText();
  const markerIdx = fullText.indexOf(`// ${marker}`);
  if (markerIdx === -1) throw new Error(`Fixture is missing marker comment: ${marker}`);
  // The next marker (or EOF) bounds how far this case's statements extend.
  const nextMarkerIdx = fullText.indexOf("// CASE_", markerIdx + marker.length);
  const upperBound = nextMarkerIdx === -1 ? fullText.length : nextMarkerIdx;

  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (node.getStart() >= markerIdx && node.getStart() < upperBound) {
      const rootName = chainRootIdentifier(node);
      if (rootName === baseName && isTopmostAccess(node) && (ts.isPropertyAccessExpression(node) || ts.isNonNullExpression(node))) {
        found.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

interface Assertion {
  name: string;
  marker: string;
  baseName: string;
  /** Which occurrence (0-based) among chains matching base/marker, in source order. */
  occurrence: number;
  /** 0-based index within that chain's own flattened path to check isGuardedAt for. Defaults to the chain's last segment. */
  targetIdx?: number;
  expectedGuarded: boolean;
}

const assertions: Assertion[] = [
  {
    name: "guarded ternary condition (l.createdBy ? ... : ...) must not be flagged",
    marker: "CASE_1_GUARDED_TERNARY",
    baseName: "l",
    occurrence: 0, // occurrence 0 is the ternary's condition `l.createdBy`; occurrence 1 is the whenTrue dereference inside the template literal
    expectedGuarded: true,
  },
  {
    name: "sibling && short-circuit (data?.nextCursor && use(data.nextCursor!)) must not be flagged",
    marker: "CASE_2_GUARDED_SHORT_CIRCUIT",
    baseName: "data",
    occurrence: 1, // occurrence 0 is `data?.nextCursor` itself (already guarded via ?.); 1 is `data.nextCursor!`
    expectedGuarded: true,
  },
  {
    name: "unguarded positive control (l.title.length) must still be flagged",
    marker: "CASE_3_UNGUARDED_POSITIVE_CONTROL",
    baseName: "l",
    occurrence: 0,
    expectedGuarded: false,
  },
  {
    name: "final-segment === test (l.safeBrowsing.status === \"clean\") must NOT mask the earlier safeBrowsing segment",
    marker: "CASE_4_FINAL_SEGMENT_TEST_MUST_NOT_MASK_EARLIER_SEGMENT",
    baseName: "l",
    occurrence: 0, // `l.safeBrowsing.status` — the whole chain, as the left operand of ===
    targetIdx: 0, // the "safeBrowsing" segment specifically, not "status" (index 1)
    expectedGuarded: false,
  },
];

let failures = 0;
for (const a of assertions) {
  const chains = findChainsAfterMarker(a.marker, a.baseName);
  const node = chains[a.occurrence];
  if (!node) {
    console.error(`FAIL: ${a.name} — expected an access chain rooted at "${a.baseName}" after ${a.marker} (occurrence ${a.occurrence}), found ${chains.length} total.`);
    failures++;
    continue;
  }
  const { path } = flattenChain(node);
  const targetIdx = a.targetIdx ?? path.length - 1;
  const guarded = isGuardedAt(node, a.baseName, path, targetIdx);
  const text = node.getText();
  if (guarded === a.expectedGuarded) {
    console.log(`PASS: ${a.name} (\`${text}\` segment[${targetIdx}]="${path[targetIdx]}" -> guarded=${guarded})`);
  } else {
    console.error(`FAIL: ${a.name} (\`${text}\` segment[${targetIdx}]="${path[targetIdx]}" -> guarded=${guarded}, expected ${a.expectedGuarded})`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${assertions.length} regression assertion(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${assertions.length} regression assertions passed.`);
