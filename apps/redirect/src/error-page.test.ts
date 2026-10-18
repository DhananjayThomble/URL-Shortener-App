import { createHash } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { ERROR_PAGE_CSP, errorResponse, escapeHtml, sendError, wantsHtml, type ErrorKind } from "./error-page.js";

/* Oracle (#766): browsers following a dead short link get a small branded HTML
   page; anything that does not ask for HTML keeps the exact plain-text body the
   redirect has always sent; status codes do not change. */

const CHROME_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
const SAFARI_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const ctx = { host: "snap.example", slug: "abc", webOrigin: "https://app.snap.example" };

const CASES: Array<[ErrorKind, 404 | 410, string]> = [
  ["not_found", 404, "No such link."],
  ["expired", 410, "This link has expired."],
  ["click_limit", 410, "This link has reached its click limit."],
  ["scheduled", 404, "This link is not live yet."],
  ["root", 404, "Nothing here."],
];

describe("wantsHtml", () => {
  it.each([CHROME_ACCEPT, SAFARI_ACCEPT, "text/html", "TEXT/HTML", "application/xhtml+xml", "text/html;q=0.5"])(
    "is true for a browser-style Accept: %s",
    (accept) => expect(wantsHtml(accept)).toBe(true),
  );

  it.each([
    undefined,
    "",
    "*/*", // curl, most HTTP libraries
    "application/json",
    "text/plain",
    "text/*",
    "text/html;q=0",
    "text/html; q=0.0",
    "image/avif,image/webp,*/*;q=0.8", // a browser fetching an <img>
  ])("is false for a non-HTML Accept: %s", (accept) => expect(wantsHtml(accept)).toBe(false));

  it("reads a repeated Accept header", () => {
    expect(wantsHtml(["application/json", "text/html"])).toBe(true);
  });
});

describe("escapeHtml", () => {
  it("escapes every character that can break out of text or an attribute", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("errorResponse — plain text for non-browsers (backward compatible)", () => {
  it.each(CASES)("%s keeps status %d and the exact legacy body", (kind, status, text) => {
    for (const accept of [undefined, "*/*", "application/json", "text/plain"]) {
      const res = errorResponse(kind, accept, ctx);
      expect(res.status).toBe(status);
      expect(res.body).toBe(text);
      expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
      expect(res.headers["content-security-policy"]).toBeUndefined();
    }
  });
});

describe("errorResponse — branded HTML for browsers", () => {
  it.each(CASES)("%s keeps status %d and renders a page", (kind, status, text) => {
    const res = errorResponse(kind, CHROME_ACCEPT, ctx);
    expect(res.status).toBe(status);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body.startsWith("<!doctype html>")).toBe(true);
    expect(res.body).toContain('<meta name="viewport"');
    expect(res.body).toContain('<meta name="robots" content="noindex">');
    expect(res.body).toContain("prefers-color-scheme:dark");
    expect(res.body).toContain('href="https://app.snap.example"');
    expect(res.body).not.toContain(text); // a page, not the bare legacy sentence
    // Tiny: no external assets, well under a few KB.
    expect(Buffer.byteLength(res.body)).toBeLessThan(3072);
    expect(res.body).not.toMatch(/<script|<link|<img|src=|url\(/i);
  });

  it("shows the short link the visitor followed", () => {
    expect(errorResponse("expired", CHROME_ACCEPT, ctx).body).toContain("<code>snap.example/abc</code>");
    expect(errorResponse("root", CHROME_ACCEPT, { host: "snap.example", webOrigin: "/" }).body).toContain(
      "<code>snap.example</code>",
    );
  });

  it("says when a scheduled link goes live", () => {
    const activatesAt = new Date("2099-01-01T00:00:00.000Z");
    const body = errorResponse("scheduled", CHROME_ACCEPT, { ...ctx, activatesAt }).body;
    expect(body).toContain('<time datetime="2099-01-01T00:00:00.000Z">Thu, 01 Jan 2099 00:00:00 GMT</time>');
  });

  it("HTML-escapes the slug, the host and the web origin (no reflected XSS)", () => {
    const evil = errorResponse("not_found", CHROME_ACCEPT, {
      host: `x"><svg onload=alert(1)>`,
      slug: `<script>alert(1)</script>`,
      webOrigin: `javascript:alert(1)"><b>`,
    }).body;
    expect(evil).not.toContain("<script>alert");
    expect(evil).not.toContain("<svg");
    expect(evil).not.toContain('"><b>');
    expect(evil).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("caps an absurdly long echoed slug", () => {
    const body = errorResponse("not_found", CHROME_ACCEPT, { ...ctx, slug: "a".repeat(5000) }).body;
    expect(body).toContain("…</code>");
    expect(Buffer.byteLength(body)).toBeLessThan(3072);
  });

  it("locks the page down with a CSP whose style hash matches the inline stylesheet", () => {
    const res = errorResponse("expired", CHROME_ACCEPT, ctx);
    expect(res.headers["content-security-policy"]).toBe(ERROR_PAGE_CSP);
    expect(ERROR_PAGE_CSP).toContain("default-src 'none'");
    expect(ERROR_PAGE_CSP).toContain("frame-ancestors 'none'");
    expect(ERROR_PAGE_CSP).not.toContain("unsafe-inline");
    const style = /<style>([\s\S]*?)<\/style>/.exec(res.body)?.[1] ?? "";
    const hash = createHash("sha256").update(style).digest("base64");
    expect(ERROR_PAGE_CSP).toContain(`'sha256-${hash}'`);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("both variants are uncacheable and vary on Accept", () => {
  /* The CDN cache key carries no headers, so without no-store the edge could
     serve one client's variant to another for its short TTL. */
  it.each(CASES)("%s", (kind) => {
    for (const accept of [CHROME_ACCEPT, "*/*"]) {
      const res = errorResponse(kind, accept, ctx);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers.vary).toBe("Accept");
    }
  });
});

describe("sendError through a real Fastify reply", () => {
  const app = Fastify();
  app.get<{ Params: { slug: string } }>("/:slug", async (request, reply) => {
    const host = request.headers.host ?? "";
    if (request.params.slug === "soon") {
      void reply.header("Retry-After", "Thu, 01 Jan 2099 00:00:00 GMT");
      return sendError(request, reply, "scheduled", { host, slug: "soon", webOrigin: "/" });
    }
    return sendError(request, reply, "expired", { host, slug: request.params.slug, webOrigin: "/" });
  });

  it("sends the HTML page with its headers intact", async () => {
    const res = await app.inject({ url: "/gone", headers: { accept: CHROME_ACCEPT } });
    expect(res.statusCode).toBe(410);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["content-security-policy"]).toBe(ERROR_PAGE_CSP);
    expect(res.body).toContain("This link has expired");
  });

  it("sends the legacy plain text to curl", async () => {
    const res = await app.inject({ url: "/gone", headers: { accept: "*/*" } });
    expect(res.statusCode).toBe(410);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.body).toBe("This link has expired.");
  });

  it("keeps Retry-After on a scheduled link in both variants", async () => {
    for (const accept of [CHROME_ACCEPT, "*/*"]) {
      const res = await app.inject({ url: "/soon", headers: { accept } });
      expect(res.statusCode).toBe(404);
      expect(res.headers["retry-after"]).toBe("Thu, 01 Jan 2099 00:00:00 GMT");
    }
  });

  it("answers HEAD with the same status and no body", async () => {
    const res = await app.inject({ method: "HEAD", url: "/gone", headers: { accept: CHROME_ACCEPT } });
    expect(res.statusCode).toBe(410);
    expect(res.body).toBe("");
  });
});
