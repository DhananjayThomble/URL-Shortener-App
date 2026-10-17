import { describe, expect, it } from "vitest";
import { bioManagedDestination, bioPagePath } from "./bio.js";

/* #650 — the two shapes a managed bio link rests on. If either drifts, a
   published page's short URL stops resolving to its renderer. */

describe("bioPagePath", () => {
  it("builds the per-domain web path", () => {
    expect(bioPagePath("snap.to", "ada")).toBe("/b/snap.to/ada");
  });

  it("URL-encodes both segments", () => {
    // A slug is [A-Za-z0-9._-] today, but encoding must not corrupt a legal
    // one and must stay safe if the rule ever loosens.
    expect(bioPagePath("my domain", "a/b")).toBe("/b/my%20domain/a%2Fb");
  });
});

describe("bioManagedDestination", () => {
  it("joins the web origin and the bio path", () => {
    expect(bioManagedDestination("https://app.snapurl.dev", "snap.to", "ada")).toBe(
      "https://app.snapurl.dev/b/snap.to/ada",
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(bioManagedDestination("https://app.snapurl.dev/", "snap.to", "ada")).toBe(
      "https://app.snapurl.dev/b/snap.to/ada",
    );
  });
});
