import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

/* #734 finding 8 — WEB_ORIGIN is the destination origin of every published bio
   page's managed link (#650), so it must be a valid absolute http(s) URL. A
   junk or non-http value must fail fast at boot rather than minting broken
   managed-link destinations later. */

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  JWT_ACCESS_SECRET: "x".repeat(32),
  JWT_REFRESH_SECRET: "y".repeat(32),
};

describe("WEB_ORIGIN validation", () => {
  it("accepts an absolute https URL", () => {
    expect(() => loadEnv({ ...base, WEB_ORIGIN: "https://app.example.com" } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("defaults to the local http origin when unset", () => {
    expect(loadEnv(base as NodeJS.ProcessEnv).WEB_ORIGIN).toBe("http://localhost:3000");
  });

  it("rejects a non-URL value", () => {
    expect(() => loadEnv({ ...base, WEB_ORIGIN: "not a url" } as NodeJS.ProcessEnv)).toThrow(/WEB_ORIGIN/);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(() => loadEnv({ ...base, WEB_ORIGIN: "ftp://example.com" } as NodeJS.ProcessEnv)).toThrow(/WEB_ORIGIN/);
  });
});
