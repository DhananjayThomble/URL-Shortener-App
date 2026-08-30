import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../config/env.js";
import { MailService } from "./mail.service.js";

/* The outbox transport used to write to process.cwd()/logs/outbox, which is a
   read-only path on Lambda (only /tmp is writable), so every invite and reset
   500'd with EROFS. These assert the fix: writes land in a writable tmp dir by
   default and can be redirected with MAIL_OUTBOX_DIR. The default-path test is
   the regression guard — it would fail against the old cwd-based code. */

function envStub(overrides: Partial<Env>): Env {
  return {
    MAIL_TRANSPORT: "outbox",
    WEB_ORIGIN: "http://localhost:3000",
    ...overrides,
  } as Env;
}

const cleanup: string[] = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    const dir = cleanup.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("MailService — outbox transport", () => {
  it("writes a message file with the To/Subject/body to MAIL_OUTBOX_DIR", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mail-test-"));
    cleanup.push(dir);
    const svc = new MailService(envStub({ MAIL_OUTBOX_DIR: dir }));

    await svc.send({ to: "user@example.com", subject: "Hello there", body: "Body content" });

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]!.endsWith(".txt")).toBe(true);

    const contents = await readFile(join(dir, files[0]!), "utf8");
    expect(contents).toContain("To: user@example.com");
    expect(contents).toContain("Subject: Hello there");
    expect(contents).toContain("Body content");
  });

  it("defaults to os.tmpdir()/snapurl-outbox, never process.cwd() (EROFS regression guard)", async () => {
    const defaultDir = resolve(tmpdir(), "snapurl-outbox");
    // Ensure a clean slate so we only observe files this test writes.
    await rm(defaultDir, { recursive: true, force: true });
    cleanup.push(defaultDir);

    const svc = new MailService(envStub({ MAIL_OUTBOX_DIR: undefined }));
    await svc.send({ to: "guard@example.com", subject: "Guard", body: "no cwd" });

    const files = await readdir(defaultDir);
    expect(files).toHaveLength(1);
    const contents = await readFile(join(defaultDir, files[0]!), "utf8");
    expect(contents).toContain("To: guard@example.com");

    // The old code wrote to process.cwd()/logs/outbox — assert nothing landed there.
    const cwdOutbox = resolve(process.cwd(), "logs/outbox");
    expect(existsSync(cwdOutbox)).toBe(false);
  });
});

describe("MailService — ses transport", () => {
  it("does not throw and writes no file when MAIL_TRANSPORT is ses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mail-test-ses-"));
    cleanup.push(dir);
    const svc = new MailService(envStub({ MAIL_TRANSPORT: "ses", MAIL_OUTBOX_DIR: dir }));

    await expect(svc.send({ to: "ses@example.com", subject: "SES", body: "dropped" })).resolves.toBeUndefined();

    const files = await readdir(dir);
    expect(files).toHaveLength(0);
  });
});
