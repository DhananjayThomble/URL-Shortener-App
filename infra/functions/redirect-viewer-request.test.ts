import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { kvsKey, kvsValue, type ProjectedLink } from "@snapurl/database";
import { buildDestination } from "@snapurl/domain";
import {
  decide,
  edgeKey,
  edgeLocation,
  formEncode,
} from "./redirect-viewer-request.logic.mjs";

/** An edge-eligible link, mirroring the `plain` fixture in
 *  packages/database/src/link-projection.test.ts. Tests override one field at a
 *  time so what is under test is obvious. */
const plainProjected: ProjectedLink = {
  id: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  destination: "https://acme.com/x",
  redirectType: "302",
  rules: [],
  expiresAt: null,
  expiresTo: null,
  activatesAt: null,
  scheduledTo: null,
  clickLimit: null,
  clicks: 0,
  hasPassword: false,
  forwardQuery: false,
  deepLink: false,
  hideReferrer: false,
  publicPreview: false,
  archived: false,
  safeBrowsingStatus: "clean",
  utm: null,
};

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

/* ============================================================
   #395 — the forwarded-query merge at the edge.

   These are the tests that make the feature safe. The edge has no URL and no
   URLSearchParams, so it hand-rolls the merge; if its output diverges from
   buildDestination by even one byte, the SAME link redirects differently
   depending on whether the edge or the Lambda answered — a cache-dependent,
   near-undebuggable inconsistency. So rather than trust the reasoning, these
   compare the edge against the real implementations over generated input.
   ============================================================ */

describe("formEncode matches URLSearchParams serialisation", () => {
  /** How URLSearchParams encodes `s` as a value, extracted from real output. */
  const refValue = (s: string) => new URLSearchParams([["x", s]]).toString().slice("x=".length);
  /** How URLSearchParams encodes `s` as a key. */
  const refKey = (s: string) => {
    const out = new URLSearchParams([[s, "v"]]).toString();
    return out.slice(0, out.length - "=v".length);
  };

  /* The characters where encodeURIComponent and the urlencoded set disagree are
     the whole reason formEncode exists, so pin them explicitly as well as
     generatively. */
  it.each([
    [" ", "+"],
    ["!", "%21"],
    ["'", "%27"],
    ["(", "%28"],
    [")", "%29"],
    ["~", "%7E"],
    ["*", "*"],
    ["-", "-"],
    [".", "."],
    ["_", "_"],
    ["+", "%2B"],
    ["%", "%25"],
    ["&", "%26"],
    ["=", "%3D"],
  ])("encodes %j as %j", (input, expected) => {
    expect(formEncode(input)).toBe(expected);
    expect(formEncode(input)).toBe(refValue(input));
  });

  it("agrees with URLSearchParams for arbitrary strings (key and value position)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (s) => {
        expect(formEncode(s)).toBe(refValue(s));
        expect(formEncode(s)).toBe(refKey(s));
      }),
      { numRuns: 500 },
    );
  });

  it("agrees with URLSearchParams for unicode and the tricky ASCII set", () => {
    fc.assert(
      fc.property(
        fc.string({
          // Array.from splits by CODE POINT, so astral characters stay whole. A
          // lone surrogate is covered separately below — it is the one input where
          // the two implementations legitimately differ.
          unit: fc.constantFrom(
            ...Array.from(" !'()~*-._+%&=?#/:@[]{}<>\"\\|^`$,;é日本語🙂"),
            "a",
            "0",
          ),
          maxLength: 30,
        }),
        (s) => {
          expect(formEncode(s)).toBe(refValue(s));
        },
      ),
      { numRuns: 500 },
    );
  });

  /* The ONE divergence, pinned deliberately rather than discovered in production:
     encodeURIComponent THROWS URIError on a lone surrogate, where URLSearchParams
     substitutes U+FFFD. That is safe by construction — edgeLocation runs inside
     decide's try/catch, so the throw becomes a fall-through to the Lambda, which
     is always a correct answer. It is also unreachable in practice: a real query
     arrives as bytes and malformed UTF-8 is already replaced before it becomes a
     JS string. Asserted so the safety argument is a test, not a comment. */
  it("throws on a lone surrogate (which decide turns into a safe fall-through)", () => {
    const loneSurrogate = "\uD83D";
    expect(() => formEncode(loneSurrogate)).toThrow(URIError);
    expect(new URLSearchParams([["x", loneSurrogate]]).toString()).toBe("x=%EF%BF%BD");
  });

  /* EXHAUSTIVE, not sampled: every code point in the BMP outside the surrogate
     range, compared against real URLSearchParams. Sampling 1000 random strings
     cannot prove a single-character encoding table; enumerating it can. */
  it("agrees with URLSearchParams for every non-surrogate BMP code point", () => {
    const mismatches: string[] = [];
    for (let cp = 0; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogates: see above
      const ch = String.fromCharCode(cp);
      if (formEncode(ch) !== refValue(ch)) mismatches.push("U+" + cp.toString(16));
    }
    expect(mismatches).toEqual([]);
  });
});

describe("the integer-like key guard declines exactly what it must", () => {
  /* Verified against real object enumeration: a key is REORDERED (enumerated
     before earlier-inserted string keys) only when it is a canonical array index
     in 0..2^32-2. The guard's regex also declines 2^32-1 and above, which are NOT
     reordered — over-declining is harmless (it just uses the Lambda), whereas
     under-declining would emit a wrongly-ordered query. */
  it.each([
    ["0", true],
    ["1", true],
    ["10", true],
    ["4294967294", true],
    ["01", false],
    ["1e2", false],
    [" 1", false],
    ["-1", false],
    ["1.0", false],
    ["a1", false],
    ["1a", false],
  ])("key %j is reordered by object enumeration: %s — and is declined iff needed", (key, reordered) => {
    const obj: Record<string, number> = {};
    obj.zz = 1;
    obj[key] = 1;
    const actuallyReordered = Object.keys(obj)[0] === key;
    expect(actuallyReordered).toBe(reordered);

    const declined =
      edgeLocation(
        JSON.parse(
          kvsValue({ ...plainProjected, destination: "https://acme.com/x", forwardQuery: true }),
        ),
        { [key]: { value: "v" } },
      ) === null;
    // Safety: anything reordered MUST be declined. The converse is optional.
    if (actuallyReordered) expect(declined).toBe(true);
  });
});

describe("edgeLocation reproduces buildDestination byte-for-byte", () => {
  /** CloudFront's parsed querystring shape for a raw query string. `value` is the
   *  first occurrence and `multiValue` carries all of them in order, which is what
   *  the real event provides for a repeated key. */
  function cfQuerystring(query: string) {
    const out: Record<string, { value: string; multiValue?: Array<{ value: string }> }> = {};
    for (const [key, value] of new URLSearchParams(query)) {
      const existing = out[key];
      if (!existing) {
        out[key] = { value };
      } else {
        existing.multiValue = existing.multiValue ?? [{ value: existing.value }];
        existing.multiValue.push({ value });
      }
    }
    return out;
  }

  /** The KVS payload the worker would store for a forwardQuery link. */
  const payloadFor = (destination: string) =>
    JSON.parse(
      kvsValue({
        ...plainProjected,
        destination,
        forwardQuery: true,
      }),
    );

  /** What the Lambda would return for the same request. */
  const viaLambda = (destination: string, incomingQuery: string) =>
    buildDestination({ destination, incomingQuery, forwardQuery: true, utm: null });

  const cases: Array<[string, string, string]> = [
    ["appends to a destination with no query", "https://acme.com/x", "a=1&b=2"],
    ["merges into an existing query", "https://acme.com/x?keep=1", "a=1"],
    ["REPLACES a colliding key in the destination's own position", "https://acme.com/x?a=old&z=9", "a=new"],
    ["keeps the fragment last", "https://acme.com/x#frag", "a=1"],
    ["merges with both an existing query and a fragment", "https://acme.com/x?a=old#frag", "a=new&b=2"],
    ["takes the LAST value of a repeated incoming key", "https://acme.com/x", "a=1&a=2&a=3"],
    ["encodes spaces as +", "https://acme.com/x", "q=hello world"],
    ["encodes the characters encodeURIComponent would leave alone", "https://acme.com/x", "q=a!b'c(d)e~f"],
    ["handles an empty value", "https://acme.com/x", "a="],
    ["normalises the destination host", "https://ACME.com", "a=1"],
    ["preserves a port and userinfo-free authority", "https://acme.com:8443/x", "a=1"],
    ["skips the unlock token k", "https://acme.com/x", "k=secret&a=1"],
    /* REGRESSION (found by the independent review, not by the property test — its
       generator could not produce an empty-but-present delimiter). When `?` or `#`
       is present but empty, url.search / url.hash are "" while href still carries
       the character, so deriving base by subtracting their LENGTHS left the
       delimiter in base and produced a genuinely wrong URL: "…/x??a=1", and worse
       "…/x#?a=1" with the query AFTER the fragment. decomposeDestination now
       splits href positionally. */
    ["empty-but-present query delimiter", "https://acme.com/x?", "a=1"],
    ["empty-but-present fragment delimiter", "https://acme.com/x#", "a=1"],
    ["both delimiters present and empty", "https://acme.com/x?#", "a=1"],
    ["fragment containing a question mark", "https://acme.com/x#f?g", "a=1"],
    ["fragment with a question mark AND an existing query", "https://acme.com/x?p=1#f?g", "a=1"],
    ["percent-encoded question mark in the path", "https://acme.com/a%3Fb", "a=1"],
    ["userinfo in the authority", "https://u:p@acme.com/x", "a=1"],
    ["IPv6 host", "https://[2001:db8::1]/x", "a=1"],
    ["non-special scheme", "mailto:a@b.com", "a=1"],
    ["non-special scheme with a query", "custom:opaque?z=1", "a=1"],
    ["default port is stripped", "https://acme.com:443/x", "a=1"],
    ["dot segments in the path", "https://acme.com/a/../b", "a=1"],
    ["query but no path", "https://acme.com?z=1", "a=1"],
  ];

  it.each(cases)("%s", (_name, destination, incomingQuery) => {
    const got = edgeLocation(payloadFor(destination), cfQuerystring(incomingQuery));
    expect(got).toBe(viaLambda(destination, incomingQuery));
  });

  it("returns the stored destination when there is no incoming query", () => {
    const payload = payloadFor("https://acme.com/x?a=1#f");
    expect(edgeLocation(payload, {})).toBe(viaLambda("https://acme.com/x?a=1#f", ""));
  });

  it("returns the raw destination (no merge) when the link does not forward the query", () => {
    const payload = JSON.parse(kvsValue({ ...plainProjected, destination: "https://acme.com/x" }));
    expect(payload.forwardQuery).toBeUndefined();
    expect(edgeLocation(payload, cfQuerystring("a=1"))).toBe("https://acme.com/x");
    // Which is also what the Lambda does with forwardQuery false.
    expect(edgeLocation(payload, cfQuerystring("a=1"))).toBe(
      buildDestination({
        destination: "https://acme.com/x",
        incomingQuery: "a=1",
        forwardQuery: false,
        utm: null,
      }),
    );
  });

  it("falls through (null) when the destination could not be decomposed", () => {
    // No `base` — e.g. a stored destination URL could not parse.
    expect(
      edgeLocation(
        { destination: "not a url", redirectType: "302", forwardQuery: true },
        cfQuerystring("a=1"),
      ),
    ).toBeNull();
  });

  it("falls through (null) when an integer-like key makes the order unrecoverable", () => {
    // "?a=1&0=2" reaches the Function as an object whose keys enumerate 0 first,
    // so the original order is lost. Declining is correct; guessing is not.
    expect(edgeLocation(payloadFor("https://acme.com/x"), cfQuerystring("a=1&0=2"))).toBeNull();
    expect(edgeLocation(payloadFor("https://acme.com/x"), cfQuerystring("2=b"))).toBeNull();
    // A non-numeric key that merely CONTAINS digits is fine.
    expect(edgeLocation(payloadFor("https://acme.com/x"), cfQuerystring("a1=b"))).toBe(
      viaLambda("https://acme.com/x", "a1=b"),
    );
  });

  /* The real guarantee, and the invariant worth stating precisely: for ANY
     destination and ANY incoming query the edge either reproduces the Lambda's
     Location EXACTLY, or it declines (null) and the request falls through. There is
     no third outcome — it never invents a different redirect. */
  it("either matches buildDestination exactly or declines, for generated input", () => {
    const token = fc.string({
      unit: fc.constantFrom(...Array.from("abcXY019 -_.~!'()*+%&=?:/#[]é🙂")),
      minLength: 1,
      maxLength: 6,
    });
    const pair = fc.tuple(token, token);

    const destination = fc
      .tuple(
        fc.constantFrom("https://acme.com", "https://acme.com:8443", "http://x.example"),
        fc.constantFrom("", "/", "/p", "/a/b"),
        fc.array(pair, { maxLength: 3 }),
        fc.constantFrom("", "#f", "#a b"),
      )
      .map(([origin, path, params, hash]) => {
        const search = params.length ? "?" + new URLSearchParams(params).toString() : "";
        return origin + path + search + hash;
      });

    const incoming = fc
      .array(pair, { maxLength: 4 })
      .map((params) => new URLSearchParams(params).toString());

    fc.assert(
      fc.property(destination, incoming, (dest, query) => {
        const got = edgeLocation(payloadFor(dest), cfQuerystring(query));
        if (got === null) return; // declined — always safe, the Lambda answers
        expect(got).toBe(viaLambda(dest, query));
      }),
      { numRuns: 1000 },
    );
  });

  /* Declining must stay RARE, or the fast path is pointless. A plain query of
     word-like keys — the overwhelmingly common case — must always merge. */
  it("does not decline for ordinary word-like query keys", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.string({ unit: fc.constantFrom(..."abcdefgxyz_".split("")), minLength: 1, maxLength: 6 }),
            fc.string({ unit: fc.constantFrom(..."abc019 -_".split("")), minLength: 0, maxLength: 6 }),
          ),
          { minLength: 1, maxLength: 4 },
        ),
        (params) => {
          const query = new URLSearchParams(params).toString();
          const got = edgeLocation(payloadFor("https://acme.com/x?keep=1"), cfQuerystring(query));
          expect(got).not.toBeNull();
          expect(got).toBe(viaLambda("https://acme.com/x?keep=1", query));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("decide serves the merged Location on a forwardQuery KVS hit", () => {
  it("returns the merged destination", async () => {
    const payload = kvsValue({
      ...plainProjected,
      destination: "https://acme.com/landing?utm_id=7",
      forwardQuery: true,
    });
    const res = await decide(
      eventFor({ uri: "/promo", querystring: { ref: { value: "news" } } }),
      async () => payload,
    );
    expect(res.statusCode).toBe(302);
    expect(res.headers.location.value).toBe(
      buildDestination({
        destination: "https://acme.com/landing?utm_id=7",
        incomingQuery: "ref=news",
        forwardQuery: true,
        utm: null,
      }),
    );
  });

  it("falls through to the origin when the payload cannot be merged", async () => {
    const res = await decide(
      eventFor({ uri: "/promo", querystring: { ref: { value: "news" } } }),
      async () => JSON.stringify({ destination: "::::", redirectType: "302", forwardQuery: true }),
    );
    // A request object (fall-through), not a response.
    expect(res.statusCode).toBeUndefined();
    expect(res.headers["x-forwarded-host"].value).toBe("snap.to");
  });
});
