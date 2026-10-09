import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * Dead-control guard (issue #661). A <Button> / <button> with no click handler
 * and no destination is a control that looks live and does nothing - the class
 * behind #661, #662 and the other "inert button" findings. This parses the
 * screens' JSX (TypeScript AST, not a regex) and fails on any button that has
 * none of: onClick, type="submit", an href, or a `{...spread}` that may carry
 * one. `disabled` is not an excuse: a permanently disabled placeholder is still
 * a promise the product does not keep.
 *
 * If this fails, either wire the button to a real effect or remove it
 * ("removed rather than faked", docs/DECISIONS.md) - do not add an empty handler.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "..");

// The three files #661 named, kept explicit so the denominator is visible.
const NAMED = ["app/(app)/analytics/page.tsx", "app/(app)/settings/page.tsx", "components/app-shell/index.tsx"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });
}

interface DeadControl {
  file: string;
  line: number;
  tag: string;
  text: string;
}

function findDeadButtons(file: string, source: string): { checked: number; dead: DeadControl[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let checked = 0;
  const dead: DeadControl[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (tag === "Button" || tag === "button") {
        checked++;
        let live = false;
        for (const attr of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attr)) {
            live = true; // props forwarded from a caller; the caller is checked where it renders
          } else if (ts.isJsxAttribute(attr)) {
            const name = attr.name.getText(sf);
            if (name === "onClick" || name === "href") live = true;
            if (name === "type" && attr.initializer && /submit/.test(attr.initializer.getText(sf))) live = true;
          }
        }
        if (!live) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const parent = node.parent;
          dead.push({
            file,
            line: line + 1,
            tag,
            text: ts.isJsxElement(parent)
              ? parent.children
                  .map((c) => c.getText(sf))
                  .join("")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 60)
              : "",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { checked, dead };
}

const describeDead = (dead: DeadControl[]) => dead.map((d) => `${relative(SRC, d.file)}:${d.line} <${d.tag}> "${d.text}"`);

describe("dead controls (#661)", () => {
  it("the detector flags a button with no handler and accepts live ones (guards the guard)", () => {
    const src = `
      export const A = () => <Button>Nothing</Button>;
      export const B = () => <button className="x">Nothing</button>;
      export const C = () => <Button onClick={go}>Live</Button>;
      export const D = () => <button type="submit">Submit</button>;
      export const E = (p) => <Button {...p}>Forwarded</Button>;
      export const F = () => <Button disabled>Disabled placeholder</Button>;
    `;
    const { checked, dead } = findDeadButtons("probe.tsx", src);
    expect(checked).toBe(6);
    expect(dead.map((d) => d.text)).toEqual(["Nothing", "Nothing", "Disabled placeholder"]);
  });

  it.each(NAMED)("%s has no <Button> without a click handler or destination", (rel) => {
    const file = resolve(SRC, rel);
    const { checked, dead } = findDeadButtons(file, readFileSync(file, "utf8"));
    expect(checked, `no buttons found in ${rel} - did the file move?`).toBeGreaterThan(0);
    expect(describeDead(dead)).toEqual([]);
  });

  /* Known debt ratchet (#706 cleared it). The set may only shrink, and it is
     now empty: a new dead button anywhere under src/app fails this test. Wire
     it to a real effect or remove it ("removed rather than faked",
     docs/DECISIONS.md) - do not add an entry. */
  const KNOWN_DEAD: string[] = [];

  it("no screen under src/app gains a dead <Button> (the #706 debt list is empty)", () => {
    const dead = walk(resolve(SRC, "app")).flatMap((f) => findDeadButtons(f, readFileSync(f, "utf8")).dead);
    const found = dead.map((d) => `${relative(SRC, d.file)} "${d.text}"`).sort();
    expect(found).toEqual([...KNOWN_DEAD].sort());
  });
});
