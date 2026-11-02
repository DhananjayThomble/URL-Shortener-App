import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../config/env.js";
import { MailService } from "./mail.service.js";
import { KillSwitchCapError, KillSwitchOffError } from "../admin/kill-switch.service.js";
import { killSwitchStub } from "../test/kill-switch.stub.js";

/* ============================================================
   #1020 — the email.outbound kill switch on MailService, no DB, no SES.

   Uses the outbox transport (writes a file per send) so "nothing changes when
   refused" is checkable by counting files. The kill-switch stub supplies the
   switch state + per-window cap; the MailService gate wraps the transport.

   Acceptance:
     • ordinary mail is BLOCKED while email.outbound is OFF (no file written);
     • AUTH-CRITICAL mail (sendEmailVerification / sendPasswordReset) BYPASSES
       the OFF switch (file written);
     • auth-critical mail is STILL capped — once the hourly window is full it is
       refused too (no file).
   ============================================================ */

function envStub(dir: string): Env {
  return { MAIL_TRANSPORT: "outbox", MAIL_OUTBOX_DIR: dir, WEB_ORIGIN: "http://localhost:3000" } as Env;
}

const cleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length > 0) {
    const dir = cleanup.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function fileCount(dir: string): Promise<number> {
  return (await readdir(dir)).length;
}

describe("MailService — email.outbound kill switch", () => {
  it("blocks ordinary mail (503) and writes NO file while the switch is OFF", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mail-ks-"));
    cleanup.push(dir);
    const svc = new MailService(envStub(dir), killSwitchStub({ changes: { "email.outbound": { on: false } } }));

    await expect(svc.send({ to: "u@example.com", subject: "News", body: "hi" })).rejects.toBeInstanceOf(
      KillSwitchOffError,
    );
    expect(await fileCount(dir)).toBe(0);
  });

  it("lets auth-critical verification mail BYPASS the OFF switch (file written)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mail-ks-"));
    cleanup.push(dir);
    const svc = new MailService(envStub(dir), killSwitchStub({ changes: { "email.outbound": { on: false } } }));

    await svc.sendEmailVerification({ to: "u@example.com", token: "tok" });
    expect(await fileCount(dir)).toBe(1);
  });

  it("lets auth-critical password-reset mail bypass the OFF switch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mail-ks-"));
    cleanup.push(dir);
    const svc = new MailService(envStub(dir), killSwitchStub({ changes: { "email.outbound": { on: false } } }));

    await svc.sendPasswordReset({ to: "u@example.com", token: "tok" });
    expect(await fileCount(dir)).toBe(1);
  });

  it("refuses auth-critical mail too once the hourly cap is full", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mail-ks-"));
    cleanup.push(dir);
    // Switch OFF, hourly cap 5, and 5 already sent this hour: the next send
    // (auth-critical) is the N+1th and is refused by the cap.
    const svc = new MailService(
      envStub(dir),
      killSwitchStub({
        changes: { "email.outbound": { on: false, emailCaps: { perHour: 5, perDay: 100 } } },
        emailsThisHour: 5,
        emailsThisDay: 5,
      }),
    );

    await expect(svc.sendEmailVerification({ to: "u@example.com", token: "tok" })).rejects.toBeInstanceOf(
      KillSwitchCapError,
    );
    expect(await fileCount(dir)).toBe(0);
  });

  it("sends ordinary mail when the switch is ON and under the cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mail-ks-"));
    cleanup.push(dir);
    const svc = new MailService(envStub(dir), killSwitchStub({ changes: { "email.outbound": { on: true } } }));

    await svc.send({ to: "u@example.com", subject: "News", body: "hi" });
    expect(await fileCount(dir)).toBe(1);
  });
});
