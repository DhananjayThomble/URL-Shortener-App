import { describe, expect, it } from "vitest";
import { normaliseHost } from "./resolver.js";

describe("normaliseHost", () => {
  it("lowercases the host so a printed QR read as SNAP.TO still resolves", () => {
    expect(normaliseHost("SNAP.TO")).toBe("snap.to");
  });

  it("trims stray whitespace from a proxy header", () => {
    expect(normaliseHost("  snap.to  ")).toBe("snap.to");
  });

  it("keeps the port, because links are created against host:port in dev", () => {
    expect(normaliseHost("localhost:3002")).toBe("localhost:3002");
  });
});
