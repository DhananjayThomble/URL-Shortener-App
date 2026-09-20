import "reflect-metadata";
import { BadRequestException, ParseUUIDPipe } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { FormsController } from "./forms.controller.js";

/* ============================================================
   Every :id route on the forms controller parses its id as a UUID at the
   edge (@Param("id", ParseUUIDPipe)), same as LinksController.

   The bug this pins (issue #533): GET /forms/not-a-uuid sent the raw string
   straight into a Drizzle `where forms.id = $1` query, and Postgres raised
   `invalid input syntax for type uuid: "not-a-uuid"` (SQLSTATE 22P02). That
   code is not in PostgresErrorFilter's map, so it surfaced as a 500 for what
   is really a malformed request. ParseUUIDPipe rejects a malformed id with a
   clean 400 BEFORE it can reach the database.

   These are pure metadata/pipe assertions — no DB, no Nest bootstrap — so they
   run in the normal (non-DB-gated) unit suite.
   ============================================================ */

function paramPipesFor(methodName: keyof FormsController): unknown[] {
  const meta =
    Reflect.getMetadata(ROUTE_ARGS_METADATA, FormsController, methodName as string) ?? {};
  const entries = Object.values(meta) as Array<{ pipes?: unknown[] }>;
  return entries.flatMap((entry) => entry.pipes ?? []);
}

function hasParseUuidPipe(methodName: keyof FormsController): boolean {
  return paramPipesFor(methodName).some(
    (pipe) => pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe,
  );
}

describe("FormsController :id routes reject a non-UUID before the DB", () => {
  for (const route of ["get", "responses", "exportResponses", "update", "remove"] as const) {
    it(`${route} parses its :id with ParseUUIDPipe`, () => {
      expect(hasParseUuidPipe(route)).toBe(true);
    });
  }
});

describe("ParseUUIDPipe turns a malformed form id into a 400, not a 500", () => {
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
