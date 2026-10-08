import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@snapurl/database";

/* #622: a webhook whose host *resolves* to an internal address must be refused
   when it is saved. A literal internal address was already refused by the
   contract; a public-looking name pointed at one was not.

   DNS is mocked (same reason as ssrf-guard.test.ts: deterministic, offline). The
   fake database records whether anything was written: for a refused endpoint,
   nothing may be. */

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

const { DevelopersService } = await import("./developers.service.js");

function fakeDb() {
  const insert = vi.fn(() => ({
    values: () => ({
      returning: async () => [{ id: "wh-1", endpoint: "https://hooks.example.com/in", events: ["link.created"] }],
    }),
  }));
  return { db: { insert } as unknown as Database, insert };
}

const input = (endpoint: string) => ({ endpoint, events: ["link.created"] }) as never;

describe("DevelopersService.createWebhook — SSRF guard (#622)", () => {
  beforeEach(() => lookupMock.mockReset());

  it("refuses an endpoint whose name resolves to the cloud metadata address", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const { db, insert } = fakeDb();
    await expect(new DevelopersService(db).createWebhook("ws-1", input("https://innocent.example/in"))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses an endpoint whose name resolves to loopback", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const { db, insert } = fakeDb();
    await expect(new DevelopersService(db).createWebhook("ws-1", input("https://rebind.example/in"))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("saves an endpoint that resolves to a public address", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const { db, insert } = fakeDb();
    const created = await new DevelopersService(db).createWebhook("ws-1", input("https://hooks.example.com/in"));
    expect(insert).toHaveBeenCalledOnce();
    expect(created.secret).toMatch(/^whsec_/);
  });
});
