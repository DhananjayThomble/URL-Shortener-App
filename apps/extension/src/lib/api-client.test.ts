import { describe, expect, it, vi } from "vitest";

import {
  ApiError,
  AuthError,
  NetworkError,
  RateLimitError,
  createLink,
  listLinks,
} from "./api-client.js";
import type { FetchImpl } from "./api-client.js";
import type { Settings } from "./storage.js";

const settings: Settings = {
  apiBaseUrl: "https://snapurl.example",
  apiKey: "snap_live_secret",
  defaultDomain: "snp.li",
};

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const sampleLink = {
  id: "lnk_1",
  domain: "snp.li",
  slug: "abc",
  destination: "https://example.com/",
  status: "active",
  clicks: 0,
  safeBrowsing: { status: "clean", checkedAt: "2024-01-01T00:00:00.000Z" },
  createdAt: "2024-01-01T00:00:00.000Z",
};

describe("api-client / createLink", () => {
  it("POSTs to /api/v1/links with a bearer token and a contract-valid body", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse(sampleLink, { status: 201 }));

    const link = await createLink(settings, { destination: "https://example.com/" }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://snapurl.example/api/v1/links");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer snap_live_secret");
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(String(init?.body));
    expect(body.destination).toBe("https://example.com/");
    expect(body.domain).toBe("snp.li");
    expect(link.id).toBe("lnk_1");
    expect(link.slug).toBe("abc");
  });

  it("passes a caller-provided domain and slug", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse(sampleLink, { status: 201 }));
    await createLink(settings, { destination: "https://example.com/", domain: "other.io", slug: "custom" }, { fetchImpl });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.domain).toBe("other.io");
    expect(body.slug).toBe("custom");
  });

  it("maps 401 to an AuthError", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse({ message: "no" }, { status: 401 }));
    await expect(createLink(settings, { destination: "https://example.com/" }, { fetchImpl })).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("maps 403 to an AuthError", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse({ message: "no" }, { status: 403 }));
    await expect(createLink(settings, { destination: "https://example.com/" }, { fetchImpl })).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("maps 429 to a RateLimitError surfacing retry-after", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse({ message: "slow down" }, { status: 429, headers: { "retry-after": "30" } }),
    );
    const err = await createLink(settings, { destination: "https://example.com/" }, { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterSeconds).toBe(30);
  });

  it("maps a fetch throw to a NetworkError", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(createLink(settings, { destination: "https://example.com/" }, { fetchImpl })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("surfaces the API message on a 4xx validation error", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse({ message: "Where should this link go?" }, { status: 400 }));
    const err = await createLink(settings, { destination: "https://example.com/" }, { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain("Where should this link go?");
  });

  it("rejects when credentials are missing before making a request", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse(sampleLink));
    await expect(
      createLink({ apiBaseUrl: "https://snapurl.example", apiKey: "" }, { destination: "https://example.com/" }, {
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a typed ApiError (not a raw ZodError) when no domain is available, before fetching", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse(sampleLink, { status: 201 }));
    const err = await createLink(
      { apiBaseUrl: "https://snapurl.example", apiKey: "snap_live_secret" },
      { destination: "https://example.com/" },
      { fetchImpl },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect((err as ApiError).message).toContain("domain");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a blank default domain the same as a missing one", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse(sampleLink, { status: 201 }));
    const err = await createLink(
      { apiBaseUrl: "https://snapurl.example", apiKey: "snap_live_secret", defaultDomain: "   " },
      { destination: "https://example.com/" },
      { fetchImpl },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("api-client / listLinks", () => {
  it("GETs /api/v1/links with the bearer token and parses a LinkList", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse({ items: [sampleLink], total: 1, nextCursor: null }));

    const list = await listLinks(settings, { limit: 10 }, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url).startsWith("https://snapurl.example/api/v1/links")).toBe(true);
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer snap_live_secret");
    expect(list.total).toBe(1);
    expect(list.items[0]?.id).toBe("lnk_1");
  });

  it("encodes query parameters onto the url", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse({ items: [], total: 0 }));
    await listLinks(settings, { limit: 5, search: "hello world" }, { fetchImpl });
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain("limit=5");
    expect(url).toContain("search=hello+world");
  });

  it("maps 401 to an AuthError", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse({ message: "no" }, { status: 401 }));
    await expect(listLinks(settings, {}, { fetchImpl })).rejects.toBeInstanceOf(AuthError);
  });
});
