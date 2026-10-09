import { describe, expect, it } from "vitest";
import { trustState } from "./trust-state";

/* Issue #647: a flagged link must not read like an unscanned one. */
describe("trustState", () => {
  it("flagged is its own state, distinct from unverified", () => {
    const flagged = trustState("flagged");
    const pending = trustState("pending");
    expect(flagged.kind).toBe("flagged");
    expect(pending.kind).toBe("unverified");
    expect(flagged.heading).not.toBe(pending.heading);
    expect(flagged.chipLabel).not.toBe(pending.chipLabel);
    expect(flagged.chipTone).toBe("bad");
    expect(flagged.chipLabel).not.toMatch(/unverified/i);
  });

  it("flagged carries a warning notice and de-emphasises continuing", () => {
    const s = trustState("flagged");
    expect(s.notice).toMatch(/do not continue/i);
    expect(s.continueLabel).toBe("Continue anyway to");
  });

  it("clean and pending keep their existing wording and have no notice", () => {
    expect(trustState("clean")).toMatchObject({
      kind: "clean",
      heading: "This link is safe to open",
      chipLabel: "No threats found",
      notice: null,
      continueLabel: "Continue to",
    });
    expect(trustState("pending")).toMatchObject({
      kind: "unverified",
      heading: "We couldn't fully verify this link",
      chipLabel: "Unverified",
      notice: null,
    });
  });

  it("?warning=unsafe escalates a not-yet-propagated status to flagged", () => {
    expect(trustState("pending", "unsafe").kind).toBe("flagged");
    expect(trustState("clean", "unsafe").kind).toBe("flagged");
  });

  it("the warning param can never make a flagged link look safer", () => {
    expect(trustState("flagged", "ok").kind).toBe("flagged");
    expect(trustState("flagged", null).kind).toBe("flagged");
    expect(trustState("pending", "something-else").kind).toBe("unverified");
  });
});
