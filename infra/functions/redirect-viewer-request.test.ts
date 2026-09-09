import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { kvsKey } from "@snapurl/database";
import { decide, edgeKey } from "./redirect-viewer-request.logic.mjs";

/*
 * Unit tests for the RedirectViewerRequest CloudFront Function decision logic
 * (#289). The runtime function imports the global `cloudfront` module, which
 * vitest cannot resolve, so these exercise the identical twin in
 * redirect-viewer-request.logic.mjs and separately assert the twin has not
 * drifted from the deployed .js.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

/** Build a minimal CloudFront viewer-request event. */
function eventFor(
  opts: {
    method?: string;
    uri?: string;
    host?: string | null;
    querystring?: Record<string, unknown>;
  } = {},
) {
  const headers: Record<string, { value: string }> = {};
  if (opts.host !== null) headers.host = { value: opts.host ?? "snap.to" };
  return {
    request: {
      method: opts.method ?? "GET",
      uri: opts.uri ?? "/foo",
      querystring: opts.querystring ?? {},
      headers,
    },
  };
}

function isRedirect(result: unknown): result is { statusCode: number; headers: Record<string, { value: string }> } {
  return typeof result === "object" && result !== null && "statusCode" in result;
}

describe("edgeKey matches @snapurl/database kvsKey", () => {
  it("produces the identical key format the writer uses", () => {
    // The Function has to rebuild the writer's key from the viewer host + path
    // with no shared code, so this is the single most important invariant.
    expect(edgeKey("SNAP.TO", "Foo")).toBe(kvsKey("SNAP.TO", "Foo"));
    expect(edgeKey("snap.to", "bar")).toBe(kvsKey("snap.to", "bar"));
    expect(edgeKey("Example.COM", "MixedCase")).toBe(kvsKey("Example.COM", "MixedCase"));
  });
});

describe("decide — KVS hit", () => {
  it("returns a 302 redirect to the stored destination on a bare GET slug", async () => {
    const kvsGet = vi.fn().mockResolvedValue(JSON.stringify({ destination: "https://dest.example/x", redirectType: "302" }));
    const event = eventFor({ uri: "/foo", host: "snap.to" });

    const result = await decide(event, kvsGet);

    expect(kvsGet).toHaveBeenCalledOnce();
    expect(kvsGet).toHaveBeenCalledWith("snap.to/foo");
    expect(isRedirect(result)).toBe(true);
    if (!isRedirect(result)) throw new Error("expected redirect");
    expect(result.statusCode).toBe(302);
    expect(result.headers.location.value).toBe("https://dest.example/x");
    expect(result.headers["cache-control"].value).toContain("no-store");
    // x-forwarded-host is still set on the (unused) request too — the header
    // mutation happens before the short-circuit.
    expect(event.request.headers["x-forwarded-host"].value).toBe("snap.to");
  });

  it("yields statusCode 301 when redirectType is '301'", async () => {
    const kvsGet = vi.fn().mockResolvedValue(JSON.stringify({ destination: "https://dest.example/perm", redirectType: "301" }));
    const result = await decide(eventFor(), kvsGet);

    expect(isRedirect(result)).toBe(true);
    if (!isRedirect(result)) throw new Error("expected redirect");
    expect(result.statusCode).toBe(301);
    expect(result.statusDescription).toBe("Moved Permanently");
  });

  it("lowercases host and slug into the key", async () => {
    const kvsGet = vi.fn().mockResolvedValue(JSON.stringify({ destination: "https://d/x", redirectType: "302" }));
    await decide(eventFor({ uri: "/Foo", host: "SNAP.TO" }), kvsGet);
    expect(kvsGet).toHaveBeenCalledWith("snap.to/foo");
  });
});

describe("decide — miss / error fall-through (request returned unchanged, x-forwarded-host set)", () => {
  it("returns the request unchanged on a KVS miss (getter resolves empty)", async () => {
    const kvsGet = vi.fn().mockResolvedValue(undefined);
    const event = eventFor();
    const result = await decide(event, kvsGet);

    expect(kvsGet).toHaveBeenCalledOnce();
    expect(result).toBe(event.request);
    expect(event.request.headers["x-forwarded-host"].value).toBe("snap.to");
  });

  it("returns the request unchanged when the getter throws (KVS error)", async () => {
    const kvsGet = vi.fn().mockRejectedValue(new Error("KeyNotFound"));
    const event = eventFor();
    const result = await decide(event, kvsGet);

    expect(kvsGet).toHaveBeenCalledOnce();
    expect(result).toBe(event.request);
    expect(event.request.headers["x-forwarded-host"].value).toBe("snap.to");
  });

  it("returns the request unchanged when the stored value is not valid JSON", async () => {
    const kvsGet = vi.fn().mockResolvedValue("not-json");
    const event = eventFor();
    const result = await decide(event, kvsGet);
    expect(result).toBe(event.request);
  });
});

describe("decide — guarded paths fall through WITHOUT calling kvs.get", () => {
  it("a slug ending in '+' (trust preview) falls through", async () => {
    const kvsGet = vi.fn();
    const event = eventFor({ uri: "/foo+" });
    const result = await decide(event, kvsGet);

    expect(kvsGet).not.toHaveBeenCalled();
    expect(result).toBe(event.request);
    expect(event.request.headers["x-forwarded-host"].value).toBe("snap.to");
  });

  it("a '?k=' unlock token falls through", async () => {
    const kvsGet = vi.fn();
    const event = eventFor({ querystring: { k: { value: "token" } } });
    const result = await decide(event, kvsGet);

    expect(kvsGet).not.toHaveBeenCalled();
    expect(result).toBe(event.request);
  });

  it("the root path '/' falls through", async () => {
    const kvsGet = vi.fn();
    const event = eventFor({ uri: "/" });
    const result = await decide(event, kvsGet);

    expect(kvsGet).not.toHaveBeenCalled();
    expect(result).toBe(event.request);
  });

  it("a multi-segment path falls through", async () => {
    const kvsGet = vi.fn();
    const event = eventFor({ uri: "/a/b" });
    const result = await decide(event, kvsGet);

    expect(kvsGet).not.toHaveBeenCalled();
    expect(result).toBe(event.request);
  });

  it("a non-GET method falls through", async () => {
    const kvsGet = vi.fn();
    for (const method of ["OPTIONS", "HEAD", "POST"]) {
      const event = eventFor({ method });
      const result = await decide(event, kvsGet);
      expect(result).toBe(event.request);
    }
    expect(kvsGet).not.toHaveBeenCalled();
  });

  it("still sets x-forwarded-host on a guarded fall-through", async () => {
    const kvsGet = vi.fn();
    const event = eventFor({ uri: "/", host: "vanity.example" });
    await decide(event, kvsGet);
    expect(event.request.headers["x-forwarded-host"].value).toBe("vanity.example");
  });
});

describe("drift guard: the tested twin equals the deployed function", () => {
  it("the DRIFT-GUARDED REGION is byte-for-byte identical in both files", () => {
    const runtime = readFileSync(new URL("redirect-viewer-request.js", `file://${here}`), "utf8");
    const twin = readFileSync(new URL("redirect-viewer-request.logic.mjs", `file://${here}`), "utf8");

    const region = (src: string) => {
      const start = src.indexOf("--- DRIFT-GUARDED REGION START");
      const end = src.indexOf("--- DRIFT-GUARDED REGION END");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      // Drop the marker line itself (its trailing comment differs by filename),
      // keep only the function bodies between the two markers.
      const body = src.slice(src.indexOf("\n", start) + 1, end);
      return body.trim();
    };

    expect(region(twin)).toBe(region(runtime));
  });
});

/*
 * Issue #357: the drift guard above only covers the shared LOGIC REGION. The
 * module scaffolding around it (imports, the handler declaration, any export) is
 * outside that region and was therefore unchecked — yet an illegal `export` or a
 * second `import` makes CloudFront reject the whole function at deploy
 * ("SyntaxError: Illegal export statement"), and an invalid function answers
 * EVERY request with a 503 rather than falling through to the origin. One line
 * can take the entire redirect path down, and the 14 logic tests would still be
 * green. These assertions pin the scaffolding of the DEPLOYED file so that can't
 * recur silently.
 */
describe("deployed CloudFront Function has valid module scaffolding (#357)", () => {
  const runtime = readFileSync(new URL("redirect-viewer-request.js", `file://${here}`), "utf8");

  it("contains NO export statement (CloudFront Functions reject one outright)", () => {
    // Any top-of-line export form: `export {`, `export default`, `export function`,
    // `export const`, `module.exports`, `exports.foo =`.
    expect(runtime).not.toMatch(/^\s*export\b/m);
    expect(runtime).not.toMatch(/^\s*module\.exports\b/m);
    expect(runtime).not.toMatch(/^\s*exports\./m);
  });

  it("imports only the allowed global `cloudfront` module, and nothing else", () => {
    const imports = runtime.match(/^\s*import\b.*$/gm) ?? [];
    // Exactly one import, and it is the runtime-allowed `import cf from "cloudfront"`.
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/import\s+cf\s+from\s+["']cloudfront["'];?/);
  });

  it("declares a global `handler` function (the runtime entry point)", () => {
    expect(runtime).toMatch(/^\s*(async\s+)?function\s+handler\s*\(/m);
  });
});
