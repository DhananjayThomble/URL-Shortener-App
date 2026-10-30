import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain .mjs helpers outside any workspace package, no type declarations
import { internalErrorBody } from "../../../qa/postman/mail-sink.mjs";
// @ts-expect-error plain .mjs helpers outside any workspace package, no type declarations
import { resolveWithin } from "../../extension/store/scripts/safe-path.mjs";

/* Regression guards for code-scanning findings in repo tooling (scripts/, qa/,
   apps/extension/store). Like mail-sink.hostcheck.test.ts, these live in the
   @snapurl/api lane because those folders are not workspace packages and have
   no test runner of their own. */

const repoRoot = resolve(__dirname, "../../..");
const cleanup: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

describe("scripts/coverage-delta.mjs (js/indirect-command-line-injection)", () => {
  it("never hands --base to a shell", () => {
    const dir = mkdtempSync(join(tmpdir(), "cov-delta-"));
    cleanup.push(dir);
    const baseline = join(dir, "baseline.json");
    writeFileSync(baseline, "{}");
    const marker = join(dir, "pwned");

    spawnSync(
      process.execPath,
      [
        join(repoRoot, "scripts/coverage-delta.mjs"),
        "--baseline", baseline,
        "--base", `$(touch ${marker})`,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(existsSync(marker)).toBe(false);
  });
});

describe("mail-sink error body (js/stack-trace-exposure)", () => {
  it("returns a fixed message and does not echo the error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = internalErrorBody(new Error("secret path /var/lib/x\n    at stack"));
    expect(body).toEqual({ error: "internal error" });
  });
});

describe("screenshot static server (js/path-injection)", () => {
  const root = resolve(tmpdir(), "dist-root");

  it("resolves ordinary paths inside the root", () => {
    expect(resolveWithin(root, "/popup.html")).toBe(join(root, "popup.html"));
    expect(resolveWithin(root, "/assets/a%20b.js")).toBe(join(root, "assets", "a b.js"));
  });

  it("rejects traversal, encoded traversal, NUL bytes and bad encoding", () => {
    expect(resolveWithin(root, "/../../etc/passwd")).toBeNull();
    expect(resolveWithin(root, "/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
    expect(resolveWithin(root, "/a%00b")).toBeNull();
    expect(resolveWithin(root, "/%E0%A4%A")).toBeNull();
  });
});
