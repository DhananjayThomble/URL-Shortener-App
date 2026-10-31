import "reflect-metadata";
import { BadRequestException, ParseUUIDPipe } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { MembersController } from "./members.controller.js";

/* ============================================================
   Every /members/:id route parses its id as a UUID at the edge, the same
   as LinksController and DomainsController (#533, #711).

   Without it, PATCH /members/not-a-uuid (and POST :id/resend, DELETE :id)
   sent the raw string into a `where id = $1` query against the `memberships`
   uuid column; Postgres raised 22P02, PostgresErrorFilter had no mapping, and
   a malformed request surfaced as a 500 plus an error-level log (#887).

   Pure metadata/pipe assertions, so they run in the non-DB unit suite.
   ============================================================ */

function hasParseUuidPipe(methodName: keyof MembersController): boolean {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, MembersController, methodName as string) ?? {};
  const entries = Object.values(meta) as Array<{ data?: unknown; pipes?: unknown[] }>;
  return entries.some(
    (entry) =>
      entry.data === "id" &&
      (entry.pipes ?? []).some((pipe) => pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe),
  );
}

describe("MembersController :id routes reject a non-UUID before the DB", () => {
  for (const route of ["changeRole", "resend", "remove"] as const) {
    it(`${route} parses its :id with ParseUUIDPipe`, () => {
      expect(hasParseUuidPipe(route)).toBe(true);
    });
  }

  it("ParseUUIDPipe turns a malformed id into a 400", async () => {
    const pipe = new ParseUUIDPipe();
    const metadata = { type: "param" as const, data: "id" };
    for (const bad of ["not-a-uuid", "1' or '1'='1", "\u0000", ""]) {
      await expect(pipe.transform(bad, metadata)).rejects.toBeInstanceOf(BadRequestException);
    }
    // A uuidv7 (what the memberships table generates) passes through.
    const id = "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b";
    await expect(pipe.transform(id, metadata)).resolves.toBe(id);
  });
});
