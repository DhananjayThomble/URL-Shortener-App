import "reflect-metadata";
import { BadRequestException, ParseUUIDPipe } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { LinksController } from "./links.controller.js";

/* ============================================================
   Every :id route on the links controller parses its id as a UUID at the
   edge (@Param("id", ParseUUIDPipe)).

   The bug this pins: POST /api/v1/links//clone sent an EMPTY id straight into
   a Drizzle `where links.id = $1` query, and Postgres raised
   `invalid input syntax for type uuid: ""` (SQLSTATE 22P02). That code is not
   in PostgresErrorFilter's map, so it surfaced as a 500 for what is really a
   malformed request. ParseUUIDPipe rejects an empty or malformed id with a
   clean 400 BEFORE it can reach the database.

   These are pure metadata/pipe assertions — no DB, no Nest bootstrap — so they
   run in the normal (non-DB-gated) unit suite.
   ============================================================ */

/** @nestjs/throttler/pipes store a param's extra pipes on the controller's
    __routeArguments__ metadata, keyed "<paramtype>:<index>". Each entry holds
    a `pipes` array. This returns the pipe classes/instances attached to the
    :id @Param of a given handler, or undefined if the handler has no such
    param. */
function paramPipesFor(methodName: keyof LinksController): unknown[] {
  const meta =
    Reflect.getMetadata(ROUTE_ARGS_METADATA, LinksController, methodName as string) ?? {};
  const entries = Object.values(meta) as Array<{ pipes?: unknown[] }>;
  return entries.flatMap((entry) => entry.pipes ?? []);
}

/** True when ParseUUIDPipe is among a handler's param pipes, whether it was
    supplied as the class (Nest instantiates it) or as an instance. */
function hasParseUuidPipe(methodName: keyof LinksController): boolean {
  return paramPipesFor(methodName).some(
    (pipe) => pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe,
  );
}

describe("LinksController :id routes reject a non-UUID before the DB", () => {
  for (const route of ["get", "clone", "update", "remove"] as const) {
    it(`${route} parses its :id with ParseUUIDPipe`, () => {
      expect(hasParseUuidPipe(route)).toBe(true);
    });
  }
});

describe("ParseUUIDPipe turns an empty or malformed id into a 400, not a 500", () => {
  const pipe = new ParseUUIDPipe();
  const metadata = { type: "param" as const, data: "id" };

  it("rejects the empty id from POST /links//clone with a 400", async () => {
    await expect(pipe.transform("", metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform("", metadata)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejects a non-UUID id with a 400", async () => {
    await expect(pipe.transform("not-a-uuid", metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("passes a well-formed UUID straight through", async () => {
    const id = "018f3e2a-1b2c-7d3e-8f90-123456789abc";
    await expect(pipe.transform(id, metadata)).resolves.toBe(id);
  });
});
