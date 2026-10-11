import "reflect-metadata";
import { BadRequestException, ParseUUIDPipe } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { DomainsController } from "./domains.controller.js";

/* ============================================================
   Every /domains/:id route parses its id as a UUID at the edge, the same
   as LinksController and DevelopersController (#533).

   Without it, PATCH /domains/not-a-uuid (and DELETE, POST :id/verify) sent
   the raw string into a `where id = $1` query and Postgres' uuid cast error
   surfaced as a 500 for what is a malformed request (#711 review, Minor-1).

   Pure metadata/pipe assertions, so they run in the non-DB unit suite.
   ============================================================ */

function hasParseUuidPipe(methodName: keyof DomainsController): boolean {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, DomainsController, methodName as string) ?? {};
  const entries = Object.values(meta) as Array<{ data?: unknown; pipes?: unknown[] }>;
  return entries.some(
    (entry) =>
      entry.data === "id" &&
      (entry.pipes ?? []).some((pipe) => pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe),
  );
}

describe("DomainsController :id routes reject a non-UUID before the DB", () => {
  for (const route of ["verify", "update", "remove"] as const) {
    it(`${route} parses its :id with ParseUUIDPipe`, () => {
      expect(hasParseUuidPipe(route)).toBe(true);
    });
  }

  it("ParseUUIDPipe answers the reviewer's inputs with a 400", async () => {
    const pipe = new ParseUUIDPipe();
    const metadata = { type: "param" as const, data: "id" };
    for (const bad of ["not-a-uuid", "1' or '1'='1", "\u0000", "localhost:3002"]) {
      await expect(pipe.transform(bad, metadata)).rejects.toBeInstanceOf(BadRequestException);
    }
    // A uuidv7 (what the domains table generates) passes through.
    const id = "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b";
    await expect(pipe.transform(id, metadata)).resolves.toBe(id);
  });
});
