import { describe, expect, it } from "vitest";
import { signPayload } from "./webhooks.js";

describe("signPayload", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event: "link.created", data: { id: "1" } });

  it("is stable for the same inputs", () => {
    expect(signPayload(secret, 1700000000, body)).toBe(signPayload(secret, 1700000000, body));
  });

  it("changes when the body changes", () => {
    expect(signPayload(secret, 1700000000, body)).not.toBe(signPayload(secret, 1700000000, body + " "));
  });

  it("includes the timestamp, so a captured delivery cannot be replayed later", () => {
    expect(signPayload(secret, 1700000000, body)).not.toBe(signPayload(secret, 1700000001, body));
  });

  it("changes with the secret, so one receiver cannot forge another's payload", () => {
    expect(signPayload(secret, 1700000000, body)).not.toBe(signPayload("whsec_other", 1700000000, body));
  });

  it("is a hex sha256", () => {
    expect(signPayload(secret, 1700000000, body)).toMatch(/^[0-9a-f]{64}$/);
  });
});
