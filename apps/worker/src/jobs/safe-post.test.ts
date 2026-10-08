import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { LookupFunction } from "node:net";

/* #622: webhook delivery must not reach our own network.

   Real DNS is replaced with a fake, so these tests can say "this name resolves to
   127.0.0.1" without depending on the network. A local server records whether a
   request actually arrived: for a blocked URL, it must not. */

const dnsAnswer = vi.fn<() => Array<{ address: string; family: number }>>();
vi.mock("node:dns", () => ({
  lookup: (_host: string, _opts: unknown, cb: (err: Error | null, addrs: unknown) => void) => cb(null, dnsAnswer()),
}));

const { safePost, guardedLookup, BlockedAddressError } = await import("./safe-post.js");

let server: http.Server;
let port: number;
let hits: Array<{ method?: string; body: string; signature?: string }>;
let reply: (res: http.ServerResponse) => void;

beforeEach(async () => {
  hits = [];
  reply = (res) => res.writeHead(200).end();
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ method: req.method, body, signature: req.headers["x-snapurl-signature"] as string });
      reply(res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  dnsAnswer.mockReset();
});

/** Test-only lookup: every name resolves to the local test server. */
const toLocalServer: LookupFunction = (_host, opts, cb) =>
  opts.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4);

const post = (url: string, lookup?: LookupFunction) =>
  safePost(url, { headers: { "X-SnapURL-Signature": "sig" }, body: '{"event":"ping"}', timeoutMs: 2_000, lookup });

describe("safePost — what is refused, before anything is sent", () => {
  it("refuses a literal loopback address", async () => {
    await expect(post(`http://127.0.0.1:${port}/hook`)).rejects.toBeInstanceOf(BlockedAddressError);
    expect(hits).toHaveLength(0);
  });

  it("refuses localhost", async () => {
    await expect(post(`http://localhost:${port}/hook`)).rejects.toBeInstanceOf(BlockedAddressError);
    expect(hits).toHaveLength(0);
  });

  it("refuses a public-looking name that resolves to loopback", async () => {
    dnsAnswer.mockReturnValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(post(`http://innocent.example:${port}/hook`)).rejects.toBeInstanceOf(BlockedAddressError);
    expect(hits).toHaveLength(0);
  });

  it("refuses a name where any one of its addresses is internal", async () => {
    // e.g. the cloud metadata address hidden among public ones
    dnsAnswer.mockReturnValue([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(post(`http://mixed.example:${port}/hook`)).rejects.toBeInstanceOf(BlockedAddressError);
    expect(hits).toHaveLength(0);
  });

  it("refuses a non-http scheme", async () => {
    await expect(post("file:///etc/passwd")).rejects.toThrow(/Only http and https/);
  });
});

describe("guardedLookup", () => {
  const ask = (all: boolean) =>
    new Promise<unknown[]>((resolve) => guardedLookup("public.example", { all }, (...args) => resolve(args)));

  it("passes a public address through, in the shape Node asked for", async () => {
    dnsAnswer.mockReturnValue([{ address: "93.184.216.34", family: 4 }]);
    expect(await ask(false)).toEqual([null, "93.184.216.34", 4]);
    expect(await ask(true)).toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
  });

  it("refuses an internal IPv6 address", async () => {
    dnsAnswer.mockReturnValue([{ address: "::1", family: 6 }]);
    const [err] = await ask(true);
    expect(err).toBeInstanceOf(BlockedAddressError);
  });
});

describe("safePost — normal delivery still works", () => {
  it("POSTs the body and headers and returns the status", async () => {
    await expect(post(`http://receiver.example:${port}/hook`, toLocalServer)).resolves.toBe(200);
    expect(hits).toEqual([{ method: "POST", body: '{"event":"ping"}', signature: "sig" }]);
  });

  it("does not follow a redirect: a 3xx is returned as-is", async () => {
    reply = (res) => res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" }).end();
    await expect(post(`http://receiver.example:${port}/hook`, toLocalServer)).resolves.toBe(302);
    expect(hits).toHaveLength(1); // only the original request; the redirect was not followed
  });

  it("gives up after the timeout", async () => {
    reply = () => {}; // never answers
    const started = Date.now();
    await expect(
      safePost(`http://receiver.example:${port}/hook`, { headers: {}, body: "{}", timeoutMs: 200, lookup: toLocalServer }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
