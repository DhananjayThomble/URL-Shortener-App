import { describe, expect, it } from "vitest";
import { resolveCorsOrigins } from "./cors-origins.js";

/* ============================================================
   resolveCorsOrigins is the pure origin-resolution used by @fastify/cors.

   The production posture must stay narrow: with no EXTENSION_ORIGINS set it
   returns exactly [WEB_ORIGIN] — byte-identical to the previous hard-coded
   [env.WEB_ORIGIN]. An operator can OPT IN to extra origins (e.g. a Chrome
   extension's chrome-extension://<id>) by setting EXTENSION_ORIGINS; those are
   appended, trimmed, de-duplicated, with blanks dropped. Development keeps
   reflecting any origin (true), matching the previous behaviour.

   Pure function, no Nest bootstrap, no DB — runs in the normal unit suite.
   ============================================================ */

describe("resolveCorsOrigins", () => {
  const webOrigin = "https://app.snapurl.example";

  it("reflects any origin in development (true)", () => {
    expect(
      resolveCorsOrigins({ nodeEnv: "development", webOrigin, extensionOrigins: undefined }),
    ).toBe(true);
  });

  it("still reflects any origin in development even when extension origins are set", () => {
    expect(
      resolveCorsOrigins({
        nodeEnv: "development",
        webOrigin,
        extensionOrigins: "chrome-extension://abcdef",
      }),
    ).toBe(true);
  });

  it("returns exactly [webOrigin] in production when no extension origins are set", () => {
    expect(
      resolveCorsOrigins({ nodeEnv: "production", webOrigin, extensionOrigins: undefined }),
    ).toEqual([webOrigin]);
  });

  it("treats whitespace-only EXTENSION_ORIGINS like unset in production", () => {
    expect(
      resolveCorsOrigins({ nodeEnv: "production", webOrigin, extensionOrigins: "   \t  " }),
    ).toEqual([webOrigin]);
    expect(
      resolveCorsOrigins({ nodeEnv: "production", webOrigin, extensionOrigins: "" }),
    ).toEqual([webOrigin]);
  });

  it("appends comma-separated extension origins in production", () => {
    expect(
      resolveCorsOrigins({
        nodeEnv: "production",
        webOrigin,
        extensionOrigins: "chrome-extension://aaaa,chrome-extension://bbbb",
      }),
    ).toEqual([webOrigin, "chrome-extension://aaaa", "chrome-extension://bbbb"]);
  });

  it("appends whitespace-separated extension origins in production", () => {
    expect(
      resolveCorsOrigins({
        nodeEnv: "production",
        webOrigin,
        extensionOrigins: "chrome-extension://aaaa chrome-extension://bbbb",
      }),
    ).toEqual([webOrigin, "chrome-extension://aaaa", "chrome-extension://bbbb"]);
  });

  it("trims, drops blanks, and de-duplicates extension origins", () => {
    expect(
      resolveCorsOrigins({
        nodeEnv: "production",
        webOrigin,
        extensionOrigins: " chrome-extension://aaaa , , chrome-extension://aaaa ,chrome-extension://bbbb ",
      }),
    ).toEqual([webOrigin, "chrome-extension://aaaa", "chrome-extension://bbbb"]);
  });

  it("does not duplicate the webOrigin if it also appears in EXTENSION_ORIGINS", () => {
    expect(
      resolveCorsOrigins({
        nodeEnv: "production",
        webOrigin,
        extensionOrigins: `${webOrigin},chrome-extension://aaaa`,
      }),
    ).toEqual([webOrigin, "chrome-extension://aaaa"]);
  });
});
