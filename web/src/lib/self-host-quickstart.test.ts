import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SELF_HOST_GUIDE_URL, SELF_HOST_QUICKSTART, SELF_HOST_QUICKSTART_LINES } from "./self-host-quickstart";

/* #795 — /self-host said "self-host in one command" and showed no command. The
   page now prints the real steps. SELF-HOSTING.md is the oracle: every command
   shown on the marketing page must appear, verbatim and in the same order, in
   that guide, so the page cannot drift from it. */

const guide = readFileSync(fileURLToPath(new URL("../../../SELF-HOSTING.md", import.meta.url)), "utf8");

/** Commands in the guide's fenced bash blocks, in document order. */
function guideCommands(): string[] {
  const out: string[] = [];
  for (const block of guide.matchAll(/```bash\n([\s\S]*?)```/g)) {
    for (const line of block[1].split("\n")) {
      const t = line.trim();
      if (t && !t.startsWith("#")) out.push(t);
    }
  }
  return out;
}

describe("self-host quick start (#795)", () => {
  it("is not a single command: it names the real sequence", () => {
    expect(SELF_HOST_QUICKSTART_LINES.length).toBeGreaterThan(1);
  });

  it("every command appears verbatim in SELF-HOSTING.md", () => {
    const known = new Set(guideCommands());
    for (const cmd of SELF_HOST_QUICKSTART_LINES) {
      expect(known.has(cmd), `not in SELF-HOSTING.md: ${cmd}`).toBe(true);
    }
  });

  it("keeps the guide's order: clone, init, pull, up, migrate", () => {
    const all = guideCommands();
    const positions = SELF_HOST_QUICKSTART_LINES.map((c) => all.indexOf(c));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("prints the commands as a copyable block, comments allowed", () => {
    for (const cmd of SELF_HOST_QUICKSTART_LINES) expect(SELF_HOST_QUICKSTART).toContain(cmd);
  });

  it("points at the guide on the default branch", () => {
    expect(SELF_HOST_GUIDE_URL).toBe("https://github.com/DhananjayThomble/URL-Shortener-App/blob/main/SELF-HOSTING.md");
  });
});
