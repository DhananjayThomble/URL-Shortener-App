import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, eq, forms, formResponses, workspaces, type Database } from "@snapurl/database";
import { NotFoundException } from "@nestjs/common";
import { FormsController } from "./forms.controller.js";
import { FormsService } from "./forms.service.js";
import type { RequestActor } from "../auth/auth.guard.js";

/* ============================================================
   FormsController.exportResponses against a real Postgres.

   The bug this pins (see forms.controller.ts): the handler used to call
   reply.raw.writeHead(200, ...) BEFORE the workspace-scoped lookup that can
   reject the id. Because FormsService.exportCsv is an async generator, its
   body — including that lookup — does not run until the `for await` pulls
   the first value, which only happens after writeHead has already put the
   head on the wire. A not-readable id then threw from inside
   PostgresErrorFilter while it tried to send a second response, which is an
   unhandled exception that kills the process (see postgres-error.filter.ts).

   The fix moves the lookup ahead of writeHead. The oracle here is not "does
   it throw" — it always did, before and after the fix — it is *whether the
   head was already committed when it throws*. A fake raw response tracks
   exactly that.

   Runs only when DATABASE_URL is set — see the note in rollup.test.ts.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** Tracks exactly what the controller does to Fastify's raw response,
 *  without pulling in a real HTTP server. */
function fakeRawResponse() {
  const chunks: string[] = [];
  const raw = {
    headWritten: false,
    ended: false,
    writeHead(_status: number, _headers: Record<string, string>) {
      raw.headWritten = true;
    },
    write(chunk: string) {
      chunks.push(chunk);
    },
    end() {
      raw.ended = true;
    },
  };
  return { raw, chunks };
}

const actorFor = (workspaceId: string): RequestActor => ({
  userId: null,
  workspaceId,
  role: "viewer",
  email: "actor@example.com",
  label: "actor@example.com",
});

describeDb("FormsController.exportResponses", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let controller: FormsController;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let formId: string;
  let otherFormId: string;

  const stamp = Date.now();

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    controller = new FormsController(new FormsService(db));

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "forms export test", slug: `forms-export-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [other] = await db
      .insert(workspaces)
      .values({ name: "forms export other", slug: `forms-export-other-${stamp}` })
      .returning({ id: workspaces.id });
    otherWorkspaceId = other!.id;

    const [form] = await db
      .insert(forms)
      .values({
        workspaceId,
        slug: `f${stamp}`,
        title: "Contact",
        fields: [{ key: "name", label: "Name", type: "text", required: true }],
      })
      .returning({ id: forms.id });
    formId = form!.id;

    await db.insert(formResponses).values({ formId, workspaceId, answers: { name: "Ada" } });

    const [otherForm] = await db
      .insert(forms)
      .values({ workspaceId: otherWorkspaceId, slug: `f-other-${stamp}`, title: "Other workspace's form", fields: [] })
      .returning({ id: forms.id });
    otherFormId = otherForm!.id;
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    if (otherWorkspaceId) await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId));
    await handle?.close();
  });

  it("streams a CSV with the header row for the happy path", async () => {
    const { raw, chunks } = fakeRawResponse();
    await controller.exportResponses(actorFor(workspaceId), formId, { raw } as never);

    expect(raw.headWritten).toBe(true);
    expect(raw.ended).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toContain("submitted_at");
    expect(chunks[0]).toContain("Name");
    expect(chunks.join("")).toContain("Ada");
  });

  it("rejects another workspace's form id with the service's normal not-found, and never commits the response head", async () => {
    const { raw } = fakeRawResponse();
    await expect(
      controller.exportResponses(actorFor(workspaceId), otherFormId, { raw } as never),
    ).rejects.toBeInstanceOf(NotFoundException);

    // This is the assertion the original bug fails: the unfixed handler calls
    // writeHead(200) before the workspace-scoped lookup ever runs, so the head
    // is committed by the time the NotFoundException surfaces.
    expect(raw.headWritten).toBe(false);
  });

  it("rejects a random, non-existent form id with the service's normal not-found, and never commits the response head", async () => {
    const { raw } = fakeRawResponse();
    const missing = randomUUID();
    await expect(controller.exportResponses(actorFor(workspaceId), missing, { raw } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(raw.headWritten).toBe(false);
  });
});
