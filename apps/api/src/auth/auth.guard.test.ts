import { describe, expect, it } from "vitest";
import { satisfiesRole } from "./auth.guard.js";

/* The role ladder is the only thing standing between a viewer and a delete
   button. It was asserted nowhere: an off-by-one in RANK would not fail a
   single test, and the symptom in production is silent — the request succeeds.

   These walk the whole matrix rather than spot-checking, because the failure
   this guards against is one cell being wrong, not the idea being wrong. */

const ROLES = ["viewer", "editor", "admin", "owner"] as const;

describe("satisfiesRole", () => {
  it("lets every role satisfy its own requirement", () => {
    // The boundary case. `have < need` vs `have <= need` is exactly the
    // off-by-one that would let an editor through an admin-only route, or
    // lock an admin out of an admin route.
    for (const role of ROLES) {
      expect(satisfiesRole(role, [role])).toBe(true);
    }
  });

  it("lets a higher role satisfy every lower requirement", () => {
    expect(satisfiesRole("owner", ["admin"])).toBe(true);
    expect(satisfiesRole("owner", ["editor"])).toBe(true);
    expect(satisfiesRole("owner", ["viewer"])).toBe(true);
    expect(satisfiesRole("admin", ["editor"])).toBe(true);
    expect(satisfiesRole("admin", ["viewer"])).toBe(true);
    expect(satisfiesRole("editor", ["viewer"])).toBe(true);
  });

  it("refuses a lower role for every higher requirement", () => {
    expect(satisfiesRole("viewer", ["editor"])).toBe(false);
    expect(satisfiesRole("viewer", ["admin"])).toBe(false);
    expect(satisfiesRole("viewer", ["owner"])).toBe(false);
    expect(satisfiesRole("editor", ["admin"])).toBe(false);
    expect(satisfiesRole("editor", ["owner"])).toBe(false);
    expect(satisfiesRole("admin", ["owner"])).toBe(false);
  });

  it("agrees with the full ordering matrix", () => {
    // Ranks are positional in ROLES, so a reordering of RANK that still
    // type-checks would break here.
    ROLES.forEach((have, haveRank) => {
      ROLES.forEach((need, needRank) => {
        expect(satisfiesRole(have, [need])).toBe(haveRank >= needRank);
      });
    });
  });

  it("takes the lowest bar when a route lists several roles", () => {
    // @Roles("admin", "editor") means "admin or editor", so an editor passes.
    expect(satisfiesRole("editor", ["admin", "editor"])).toBe(true);
    expect(satisfiesRole("viewer", ["admin", "editor"])).toBe(false);
    expect(satisfiesRole("owner", ["viewer", "owner"])).toBe(true);
  });

  it("allows anything when a route requires no role", () => {
    // Matches the guard, which only runs the check when required?.length.
    expect(satisfiesRole("viewer", [])).toBe(true);
  });

  it("fails closed on an unrecognised caller role", () => {
    // A role that is not in RANK ranks below viewer rather than above owner.
    expect(satisfiesRole("superuser", ["viewer"])).toBe(false);
    expect(satisfiesRole("", ["viewer"])).toBe(false);
  });

  it("fails closed on an unrecognised required role", () => {
    // A typo in a @Roles decorator must lock everyone out, not let everyone in.
    expect(satisfiesRole("owner", ["administrator"])).toBe(false);
  });

  it("still grants access when one of several required roles is a typo", () => {
    // The bar is the lowest *recognised* requirement; the typo scores 99 and
    // loses the Math.min, so a real role alongside it still governs.
    expect(satisfiesRole("editor", ["administrator", "editor"])).toBe(true);
  });
});
