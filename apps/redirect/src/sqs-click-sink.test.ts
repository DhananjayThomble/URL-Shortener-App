import { describe, expect, it, vi } from "vitest";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { deserializeClickEvent, type ClickEvent } from "@snapurl/database";
import { SqsClickSink } from "./click-sink.js";

/* MOCK-based unit tests, mirroring packages/cache/dynamodb-cache-store.test.ts:
   no live SQS in-sandbox or in CI, so a fake SQSClient whose `send` is stubbed
   by command constructor name asserts record() issues the RIGHT command to the
   configured queue with a JSON body that round-trips the ClickEvent. */

const QUEUE_URL = "https://sqs.ap-south-1.amazonaws.com/123456789012/snapurl-clicks";

function commandName(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

const clickEvent: ClickEvent = {
  linkId: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  occurredAt: new Date("2025-01-02T03:04:05.678Z"),
  visitorHash: "abcdef0123456789abcdef0123456789",
  country: "IN",
  city: "Pune",
  device: "android",
  browser: "Chrome",
  os: "Android",
  referrerHost: "example.com",
  isQr: false,
  isBot: false,
  blockedReason: null,
  matchedRuleId: null,
  variant: null,
};

describe("SqsClickSink", () => {
  it("issues a SendMessageCommand whose JSON body round-trips the ClickEvent to the configured queue", async () => {
    let captured: any;
    const send = vi.fn(async (command: unknown) => {
      expect(commandName(command)).toBe("SendMessageCommand");
      captured = (command as { input: any }).input;
      return {};
    });
    const client = { send } as unknown as SQSClient;

    const sink = new SqsClickSink(client, QUEUE_URL);
    await sink.record(clickEvent);

    expect(send).toHaveBeenCalledTimes(1);
    expect(captured.QueueUrl).toBe(QUEUE_URL);
    // occurredAt is serialised as an ISO string on the wire...
    expect(JSON.parse(captured.MessageBody).occurredAt).toBe("2025-01-02T03:04:05.678Z");
    // ...and deserializeClickEvent (the worker's path) revives the exact event.
    expect(deserializeClickEvent(captured.MessageBody)).toEqual(clickEvent);
  });

  it("awaits the send: record() resolves only after send resolves", async () => {
    let sendResolved = false;
    const send = vi.fn(async () => {
      // Defer to a later microtask so an un-awaited record() would resolve first.
      await Promise.resolve();
      sendResolved = true;
      return {};
    });
    const client = { send } as unknown as SQSClient;

    const sink = new SqsClickSink(client, QUEUE_URL);
    await sink.record(clickEvent);

    // If record() did not await the send, this would still be false here.
    expect(sendResolved).toBe(true);
  });
});
