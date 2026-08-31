import { describe, expect, it } from "vitest";

import { buildShortUrl, shortUrlScheme } from "./short-url.js";

/*
 * Short-URL construction.
 *
 * The Link contract exposes only domain + slug, so the extension synthesizes the
 * public short URL and has to pick a scheme. Hard-coding https breaks the
 * self-hosted default (localhost:3002 over http), so the scheme is derived: from
 * the configured API base URL when the host matches, otherwise from a host
 * heuristic. These tests pin that behaviour on the otherwise untested wiring path.
 */

describe("shortUrlScheme", () => {
  it("borrows the API base URL protocol when the domain host matches", () => {
    expect(shortUrlScheme("localhost:3002", { apiBaseUrl: "http://localhost:3002" })).toBe("http");
    expect(shortUrlScheme("go.example", { apiBaseUrl: "https://go.example" })).toBe("https");
  });

  it("borrows the API base scheme even when ports differ but hosts match", () => {
    // The API listens on :4000 but redirects/short domain is the same host.
    expect(shortUrlScheme("localhost:3002", { apiBaseUrl: "http://localhost:4000" })).toBe("http");
  });

  it("treats loopback hosts as http when there is no matching base URL", () => {
    expect(shortUrlScheme("localhost:3002")).toBe("http");
    expect(shortUrlScheme("localhost")).toBe("http");
    expect(shortUrlScheme("dev.localhost")).toBe("http");
    expect(shortUrlScheme("127.0.0.1:8080")).toBe("http");
  });

  it("treats a domain with an explicit port as http", () => {
    expect(shortUrlScheme("my-host.internal:3002")).toBe("http");
  });

  it("defaults to https for a plain public domain", () => {
    expect(shortUrlScheme("snp.li")).toBe("https");
    expect(shortUrlScheme("go.example")).toBe("https");
  });

  it("does not borrow the base scheme when the host does not match", () => {
    // API on http elsewhere must not force the public short domain to http.
    expect(shortUrlScheme("snp.li", { apiBaseUrl: "http://localhost:3002" })).toBe("https");
  });

  it("falls back to the host heuristic when the base URL is malformed", () => {
    expect(shortUrlScheme("localhost:3002", { apiBaseUrl: "not a url" })).toBe("http");
    expect(shortUrlScheme("snp.li", { apiBaseUrl: "not a url" })).toBe("https");
  });
});

describe("buildShortUrl", () => {
  it("builds an https URL for a hosted domain", () => {
    expect(buildShortUrl({ domain: "snp.li", slug: "abc" })).toBe("https://snp.li/abc");
  });

  it("builds an http URL for the self-hosted localhost default", () => {
    expect(buildShortUrl({ domain: "localhost:3002", slug: "abc" }, { apiBaseUrl: "http://localhost:3002" })).toBe(
      "http://localhost:3002/abc",
    );
  });

  it("builds an http URL for localhost even without a base URL", () => {
    expect(buildShortUrl({ domain: "localhost:3002", slug: "xyz" })).toBe("http://localhost:3002/xyz");
  });
});
