import "reflect-metadata";
import { BadRequestException, ParseUUIDPipe } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { DevelopersController } from "./developers.controller.js";

/* ============================================================
   Every :id route on the developers controller (api-keys, webhooks) parses
   its id as a UUID at the edge (@Param("id", ParseUUIDPipe)), same as
   LinksController.

   The bug this pins (issue #533): DELETE /api-keys/not-a-uuid and
   DELETE /webhooks/not-a-uuid sent the raw string straight into a Drizzle
   `where id = $1` query, and Postgres raised `invalid input syntax for type
   uuid` (SQLSTATE 22P02). That code is not in PostgresErrorFilter's map, so
   it surfaced as a 500 for what is really a malformed request. ParseUUIDPipe
   rejects a malformed id with a clean 400 BEFORE it can reach the database.

   These are pure metadata/pipe assertions — no DB, no Nest bootstrap — so they
   run in the normal (non-DB-gated) unit suite.
   ============================================================ */

function paramPipesFor(methodName: keyof DevelopersController): unknown[] {
  const meta =
    Reflect.getMetadata(ROUTE_ARGS_METADATA, DevelopersController, methodName as string) ?? {};
  const entries = Object.values(meta) as Array<{ pipes?: unknown[] }>;
  return entries.flatMap((entry) => entry.pipes ?? []);
}

function hasParseUuidPipe(methodName: keyof DevelopersController): boolean {
  return paramPipesFor(methodName).some(
    (pipe) => pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe,
  );
}

describe("DevelopersController :id routes reject a non-UUID before the DB", () => {
  for (const route of ["revokeKey", "removeWebhook"] as const) {
    it(`${route} parses its :id with ParseUUIDPipe`, () => {
      expect(hasParseUuidPipe(route)).toBe(true);
    });
  }
});

describe("ParseUUIDPipe turns a malformed id into a 400, not a 500", () => {
  const pipe = new ParseUUIDPipe();
  const metadata = { type: "param" as const, data: "id" };

  it("rejects a non-UUID id with a 400", async () => {
    await expect(pipe.transform("not-a-uuid", metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform("not-a-uuid", metadata)).rejects.toMatchObject({ status: 400 });
  });

  it("passes a well-formed UUID straight through", async () => {
    const id = "018f3e2a-1b2c-7d3e-8f90-123456789abc";
    await expect(pipe.transform(id, metadata)).resolves.toBe(id);
  });
});
