import { describe, expect, it } from "vitest";
import { escapeLike } from "./sql-like.js";

describe("escapeLike", () => {
  it("leaves an ordinary term alone", () => {
    expect(escapeLike("clqatag")).toBe("clqatag");
    expect(escapeLike("café 日本語")).toBe("café 日本語");
    expect(escapeLike("")).toBe("");
  });

  it("escapes the two wildcards and the escape character itself", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("escapes every occurrence, and does not double-escape", () => {
    expect(escapeLike("%_%")).toBe("\\%\\_\\%");
    expect(escapeLike("\\%")).toBe("\\\\\\%");
  });
});
