import { describe, expect, it } from "vitest";
import { toProjectionOp } from "./outbox.js";

/* The claimed-row -> op mapping drainOutbox uses on both its paths. A domain op
   must carry its host out of the payload (the domain row may already be gone
   when it is applied); link ops are unchanged. */
describe("toProjectionOp", () => {
  it("passes a link op through unchanged", () => {
    expect(toProjectionOp({ link_id: "l1", operation: "upsert", payload: { linkId: "l1" } })).toEqual({
      linkId: "l1",
      operation: "upsert",
    });
    expect(toProjectionOp({ link_id: "l1", operation: "delete", payload: null })).toEqual({
      linkId: "l1",
      operation: "delete",
    });
  });

  it("lifts the host off a domain op's payload", () => {
    expect(
      toProjectionOp({ link_id: "d1", operation: "domain", payload: { domainId: "d1", host: "go.acme.com", operation: "domain" } }),
    ).toEqual({ linkId: "d1", operation: "domain", host: "go.acme.com" });
  });

  it("tolerates a domain op with no usable host", () => {
    expect(toProjectionOp({ link_id: "d1", operation: "domain", payload: null })).toEqual({ linkId: "d1", operation: "domain" });
    expect(toProjectionOp({ link_id: "d1", operation: "domain", payload: { host: 42 } })).toEqual({
      linkId: "d1",
      operation: "domain",
    });
  });
});
