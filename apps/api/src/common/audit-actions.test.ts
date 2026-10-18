import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, describeAuditAction, humaniseAuditKey } from "@snapurl/domain";

/* #783 — every audit key this API writes must have human copy.

   ActivityInput.auditAction and MembersService.writeAudit are typed to
   AuditAction, so tsc already refuses an unlisted key at those two call
   shapes. This scan is the backstop for the shapes the type cannot see: a raw
   `insert(auditLog).values({ action: "..." })` (AuthService writes
   member.joined that way, inside the accept-invite transaction), a ternary, or
   a future writer that bypasses both helpers. It reads the API's own sources,
   so a new writer is covered the moment it exists. */

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.includes("test-harness") ? [path] : [];
  });
}

const KEY = /"([a-z][a-z_]*\.[a-z][a-z_]*)"/g;

/** Every string literal that is written as an audit action, with where. */
function writtenKeys(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8");
    const where = relative(SRC, file);
    const take = (fragment: string) => {
      for (const m of fragment.matchAll(KEY)) found.set(m[1]!, where);
    };
    // recordActivity({ auditAction: "a" }) / auditAction: cond ? "a" : "b"
    for (const m of text.matchAll(/auditAction:([^\n]*)/g)) take(m[1]!);
    // this.writeAudit(ws, actorId, label, "a", ...)
    for (const m of text.matchAll(/writeAudit\(([^)]*)/g)) take(m[1]!);
    // a direct insert(auditLog).values({ ... action: "a" ... })
    for (const m of text.matchAll(/insert\(auditLog\)\.values\(\{([\s\S]*?)\}\)/g)) {
      for (const a of m[1]!.matchAll(/action:([^\n]*)/g)) take(a[1]!);
    }
    // let auditAction: AuditAction = cond ? "a" : ... (multi-line ternary)
    for (const m of text.matchAll(/const auditAction: AuditAction =([\s\S]*?);/g)) take(m[1]!);
  }
  return found;
}

describe("audit actions written by the API (#783)", () => {
  const written = writtenKeys();

  it("finds the writers (the scan itself is not silently empty)", () => {
    // member.*, link.*, form.*, domain.*, bio_page.*, apikey.*, webhook.* at least.
    expect(written.size).toBeGreaterThanOrEqual(20);
    expect([...written.keys()]).toEqual(expect.arrayContaining(["member.joined", "form.created", "bio_page.published"]));
  });

  it("every written key is a known action with its own human label", () => {
    const known = new Set<string>(AUDIT_ACTIONS);
    const unlabelled = [...written].filter(([key]) => !known.has(key)).map(([key, where]) => `${key} (${where})`);
    expect(unlabelled, "add these to AUDIT_ACTIONS and LABELS in packages/domain/src/audit.ts").toEqual([]);

    for (const key of written.keys()) {
      const copy = describeAuditAction(key, {});
      expect(copy).not.toBe(key);
      expect(copy).not.toBe(humaniseAuditKey(key));
    }
  });

  it("every listed action is actually written somewhere (no dead copy)", () => {
    const dead = AUDIT_ACTIONS.filter((a) => !written.has(a));
    expect(dead).toEqual([]);
  });
});
