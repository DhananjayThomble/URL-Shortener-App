import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config/env.js";
import { MailService } from "./mail.service.js";
import { SESClient } from "@aws-sdk/client-ses";

/* SESClient is mocked at the module level, not constructor-injected: unlike
   SqsClickSink (apps/redirect), MailService is a NestJS @Injectable resolved
   through DI, so giving it an SESClient constructor param would mean
   registering a provider for it in mail.module.ts just to satisfy a test.
   vi.mock keeps that DI surface untouched — MailService still takes only
   ENV — while still exercising the real SendEmailCommand shape rather than
   asserting nothing happened. */
const sendMock = vi.fn();
vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  SendEmailCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}));

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

    /* The old code wrote to process.cwd()/logs/outbox. Snapshot that dir's
       contents *before* the send so the guard reacts only to what this send
       writes: a stale logs/outbox left by a previous run of the old code must
       not cause a spurious pass or fail. We assert on the delta, not on
       ambient filesystem state. */
    const cwdOutbox = resolve(process.cwd(), "logs/outbox");
    const cwdOutboxBefore = existsSync(cwdOutbox) ? await readdir(cwdOutbox) : [];

    const svc = new MailService(envStub({ MAIL_OUTBOX_DIR: undefined }));
    await svc.send({ to: "guard@example.com", subject: "Guard", body: "no cwd" });

    // Load-bearing assertion: the message landed in the tmpdir default.
    const files = await readdir(defaultDir);
    expect(files).toHaveLength(1);
    const contents = await readFile(join(defaultDir, files[0]!), "utf8");
    expect(contents).toContain("To: guard@example.com");

    // Guard: this send must not have written anything to process.cwd()/logs/outbox.
    const cwdOutboxAfter = existsSync(cwdOutbox) ? await readdir(cwdOutbox) : [];
    expect(cwdOutboxAfter).toEqual(cwdOutboxBefore);
  });
});

describe("MailService — ses transport", () => {
  beforeEach(() => {
    sendMock.mockReset();
    vi.mocked(SESClient).mockClear();
  });

  it("sends via SES with the configured MAIL_FROM as the source", async () => {
    sendMock.mockResolvedValueOnce({ MessageId: "test-message-id" });
    const svc = new MailService(
      envStub({ MAIL_TRANSPORT: "ses", MAIL_FROM: "SnapURL <no-reply@snapurl.in>" }),
    );

    await svc.send({ to: "member@example.com", subject: "You're invited", body: "Join the workspace." });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      Source: "SnapURL <no-reply@snapurl.in>",
      Destination: { ToAddresses: ["member@example.com"] },
      Message: {
        Subject: { Data: "You're invited", Charset: "UTF-8" },
        Body: { Text: { Data: "Join the workspace.", Charset: "UTF-8" } },
      },
    });
  });

  it("writes no outbox file for the ses transport", async () => {
    sendMock.mockResolvedValueOnce({});
    const dir = await mkdtemp(join(tmpdir(), "mail-test-ses-"));
    cleanup.push(dir);
    const svc = new MailService(envStub({ MAIL_TRANSPORT: "ses", MAIL_OUTBOX_DIR: dir }));

    await svc.send({ to: "ses@example.com", subject: "SES", body: "sent for real" });

    const files = await readdir(dir);
    expect(files).toHaveLength(0);
  });

  it("propagates a rejected send rather than swallowing it", async () => {
    sendMock.mockRejectedValueOnce(new Error("MessageRejected: Email address not verified"));
    const svc = new MailService(envStub({ MAIL_TRANSPORT: "ses" }));

    await expect(svc.send({ to: "unverified@example.com", subject: "x", body: "y" })).rejects.toThrow(
      "MessageRejected",
    );
  });

  it("reuses one SESClient across repeated sends rather than reconnecting per call", async () => {
    sendMock.mockResolvedValue({});
    const svc = new MailService(envStub({ MAIL_TRANSPORT: "ses" }));

    await svc.send({ to: "a@example.com", subject: "1", body: "1" });
    await svc.send({ to: "b@example.com", subject: "2", body: "2" });

    expect(vi.mocked(SESClient)).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});
