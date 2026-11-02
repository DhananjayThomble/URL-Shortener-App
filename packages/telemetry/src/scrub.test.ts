import { describe, expect, it } from "vitest";
import { scrubEvent, stripQueryString, REDACTED, type ScrubbableEvent } from "./scrub.js";

/* The security-critical test (#995 point 2): prove that passwords, tokens,
   cookies, Authorization headers, query strings and request bodies never leave
   the process. The scrubber is pure, so this needs no Sentry and no network —
   a plain event object in, a scrubbed one out. */

describe("stripQueryString", () => {
  it("drops everything after the first ? or #", () => {
    expect(stripQueryString("https://app/x?token=abc")).toBe("https://app/x");
    expect(stripQueryString("/links?access_token=zzz&page=2")).toBe("/links");
    expect(stripQueryString("https://app/x#frag")).toBe("https://app/x");
    expect(stripQueryString("https://app/x")).toBe("https://app/x");
  });
});

describe("scrubEvent — request", () => {
  it("strips the query string from request.url and drops query_string", () => {
    const out = scrubEvent({
      request: { url: "https://app/api/v1/links?access_token=supersecret", query_string: "access_token=supersecret" },
    });
    expect(out.request?.url).toBe("https://app/api/v1/links");
    expect(out.request?.query_string).toBeUndefined();
  });

  it("drops the request body wholesale", () => {
    const out = scrubEvent({
      request: { data: { password: "hunter2", email: "a@b.com", nested: { refreshToken: "rt" } } },
    });
    expect(out.request?.data).toBeUndefined();
  });

  it("drops cookies", () => {
    const out = scrubEvent({ request: { cookies: { session: "sess-abc" } } });
    expect(out.request?.cookies).toBeUndefined();
  });

  it("drops Authorization, Cookie and Set-Cookie headers entirely (any case)", () => {
    const out = scrubEvent({
      request: {
        headers: {
          Authorization: "Bearer tok",
          cookie: "session=abc",
          "Set-Cookie": "session=abc; HttpOnly",
          "proxy-authorization": "Basic xyz",
          "content-type": "application/json",
          "user-agent": "curl/8",
          "x-request-id": "req-123",
        },
      },
    });
    const headers = out.request?.headers ?? {};
    expect(headers.Authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(headers["Set-Cookie"]).toBeUndefined();
    expect(headers["proxy-authorization"]).toBeUndefined();
    // Non-sensitive headers survive — x-request-id is how an event links to logs.
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["user-agent"]).toBe("curl/8");
    expect(headers["x-request-id"]).toBe("req-123");
  });

  it("redacts other sensitive-named headers (e.g. x-api-key, x-razorpay-signature)", () => {
    const out = scrubEvent({
      request: { headers: { "x-api-key": "k", "x-razorpay-signature": "sig", "x-auth-token": "t" } },
    });
    const headers = out.request?.headers ?? {};
    expect(headers["x-api-key"]).toBe(REDACTED);
    expect(headers["x-razorpay-signature"]).toBe(REDACTED);
    expect(headers["x-auth-token"]).toBe(REDACTED);
  });
});

describe("scrubEvent — extra/contexts/tags tree", () => {
  it("redacts sensitive-named keys anywhere in the tree, case-insensitively", () => {
    const out = scrubEvent({
      extra: {
        Password: "p",
        accessToken: "at",
        apiKey: "k",
        innocuous: "keep-me",
        nested: { refresh_token: "rt", keepNested: "ok", deeper: { secret: "s", jwt: "j" } },
        list: [{ authorization: "a" }, { fine: "f" }],
      },
    });
    const extra = out.extra ?? {};
    expect(extra.Password).toBe(REDACTED);
    expect(extra.accessToken).toBe(REDACTED);
    expect(extra.apiKey).toBe(REDACTED);
    expect(extra.innocuous).toBe("keep-me");
    const nested = extra.nested as Record<string, unknown>;
    expect(nested.refresh_token).toBe(REDACTED);
    expect(nested.keepNested).toBe("ok");
    const deeper = nested.deeper as Record<string, unknown>;
    expect(deeper.secret).toBe(REDACTED);
    expect(deeper.jwt).toBe(REDACTED);
    const list = extra.list as Array<Record<string, unknown>>;
    expect(list[0]?.authorization).toBe(REDACTED);
    expect(list[1]?.fine).toBe("f");
  });

  it("does not mutate the input event", () => {
    const input: ScrubbableEvent = { request: { data: { password: "p" } }, extra: { token: "t" } };
    const out = scrubEvent(input);
    expect(input.request?.data).toEqual({ password: "p" });
    expect(input.extra?.token).toBe("t");
    expect(out).not.toBe(input);
  });

  it("leaves a clean event untouched in substance", () => {
    const out = scrubEvent({ request: { url: "/health", headers: { "content-type": "text/plain" } }, tags: { service: "api" } });
    expect(out.request?.url).toBe("/health");
    expect(out.tags?.service).toBe("api");
  });
});
