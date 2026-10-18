import { describe, expect, it } from "vitest";
import {
  parseBulkRows,
  parseRows,
  resubmitText,
  rowsToResubmit,
  summarizeBulkResult,
  UNREPORTED_ROW_ERROR,
  type BulkOutcome,
  type RowOutcome,
} from "./bulk-create-rows";

/* #755 — after a partial failure the whole textarea was sent again, and every
   row WITHOUT a back-half was created a second time (the API can only dedupe by
   slug, and a slug-less row gets a new random one on each request). The panel
   now puts back into the box only the rows that did not come back created, so a
   plain resubmit cannot resend one that succeeded. These tests pin the
   "which rows may be resent" decision, which is pure. */

const ok = (index: number): RowOutcome => ({ index, ok: true });
const bad = (index: number): RowOutcome => ({ index, ok: false });

const LIST = [
  "https://acme.com/spring", // no slug
  "https://acme.com/summer, summer-sale", // slug
  "not a url", // invalid
  "https://acme.com/fall", // no slug
  "https://acme.com/winter, taken", // slug that already exists (skipped)
].join("\n");

describe("parseBulkRows", () => {
  it("keeps parseRows' rows and order, adding the source line", () => {
    expect(parseBulkRows(LIST).map(({ destination, slug }) => (slug ? { destination, slug } : { destination }))).toEqual(
      parseRows(LIST),
    );
  });

  it("holds the trimmed line, and skips blank lines like parseRows (so indexes line up with the submitted batch)", () => {
    const rows = parseBulkRows("\n  https://acme.com/a  \n\n   \n https://acme.com/b,  b-slug \n");
    expect(rows.map((r) => r.line)).toEqual(["https://acme.com/a", "https://acme.com/b,  b-slug"]);
    expect(rows).toHaveLength(parseRows("\n  https://acme.com/a  \n\n   \n https://acme.com/b,  b-slug \n").length);
  });
});

describe("rowsToResubmit", () => {
  const rows = parseBulkRows(LIST);

  it("all succeeded: nothing is left to resend", () => {
    expect(rowsToResubmit(rows, rows.map((_, i) => ok(i)))).toEqual([]);
    expect(resubmitText(rows, rows.map((_, i) => ok(i)))).toBe("");
  });

  it("all failed: every row stays, unchanged and in order", () => {
    const out = rowsToResubmit(rows, rows.map((_, i) => bad(i)));
    expect(out.map((r) => r.row)).toEqual(rows);
    expect(out.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
    expect(resubmitText(rows, rows.map((_, i) => bad(i)))).toBe(LIST);
  });

  it("mixed (the reported shape): created rows — with AND without a slug — are dropped, failed ones kept with their original index", () => {
    const outcomes = [ok(0), ok(1), bad(2), ok(3), bad(4)];
    const out = rowsToResubmit(rows, outcomes);
    expect(out.map((r) => r.index)).toEqual([2, 4]);
    expect(resubmitText(rows, outcomes)).toBe(["not a url", "https://acme.com/winter, taken"].join("\n"));
  });

  it("the slug-less rows that were created are the ones that must not come back (the duplicate in #755)", () => {
    const text = resubmitText(rows, [ok(0), ok(1), bad(2), ok(3), bad(4)]);
    expect(text).not.toContain("https://acme.com/spring");
    expect(text).not.toContain("https://acme.com/fall");
  });

  it("outcomes may arrive in any order", () => {
    expect(resubmitText(rows, [bad(4), ok(3), bad(2), ok(1), ok(0)])).toBe(
      ["not a url", "https://acme.com/winter, taken"].join("\n"),
    );
  });

  it("two lines with the same destination are two rows: only the one that failed is kept", () => {
    const dup = parseBulkRows(["https://acme.com/same", "https://acme.com/same", "https://acme.com/same"].join("\n"));
    const out = rowsToResubmit(dup, [ok(0), bad(1), ok(2)]);
    expect(out.map((r) => r.index)).toEqual([1]);
    expect(resubmitText(dup, [ok(0), bad(1), ok(2)])).toBe("https://acme.com/same");
  });

  it("the same destination under different back-halves stays separate", () => {
    const rows2 = parseBulkRows(["https://acme.com/x, a", "https://acme.com/x, b"].join("\n"));
    expect(resubmitText(rows2, [ok(0), bad(1)])).toBe("https://acme.com/x, b");
  });

  it("a row the response says nothing about is kept (never drop what we cannot confirm was created)", () => {
    expect(rowsToResubmit(rows, [ok(0), ok(1)]).map((r) => r.index)).toEqual([2, 3, 4]);
    expect(resubmitText(rows, [])).toBe(LIST);
  });

  it("an outcome for an index outside the batch is ignored", () => {
    expect(rowsToResubmit(rows, [ok(99), ok(-1), ok(0)]).map((r) => r.index)).toEqual([1, 2, 3, 4]);
  });

  it("if one index is reported twice, a success wins", () => {
    expect(rowsToResubmit(rows, [bad(0), ok(0)]).map((r) => r.index)).not.toContain(0);
    expect(rowsToResubmit(rows, [ok(0), bad(0)]).map((r) => r.index)).not.toContain(0);
  });

  it("an empty batch has nothing to resend", () => {
    expect(rowsToResubmit([], [])).toEqual([]);
    expect(resubmitText([], [])).toBe("");
  });

  it("round trip: feeding the text back through the parser yields exactly the failed rows' requests", () => {
    const outcomes = [ok(0), ok(1), bad(2), ok(3), bad(4)];
    const again = parseRows(resubmitText(rows, outcomes));
    expect(again).toEqual([{ destination: "not a url" }, { destination: "https://acme.com/winter", slug: "taken" }]);
  });

  it("edits between submits: what the user typed into the shrunken box is what the next batch is built from", () => {
    const first = resubmitText(rows, [ok(0), ok(1), bad(2), ok(3), bad(4)]);
    // The user fixes the bad URL and picks another back-half for the taken one.
    const edited = first.replace("not a url", "https://acme.com/fixed").replace(", taken", ", winter-sale");
    expect(parseRows(edited)).toEqual([
      { destination: "https://acme.com/fixed" },
      { destination: "https://acme.com/winter", slug: "winter-sale" },
    ]);
    // ...and a second partial result is resolved against THAT batch, not the first.
    const second = parseBulkRows(edited);
    expect(resubmitText(second, [ok(0), bad(1)])).toBe("https://acme.com/winter, winter-sale");
  });

  it("is not tripped by a destination with commas in its query string", () => {
    const r = parseBulkRows("https://x.org/s?tags=a,b,c\nhttps://x.org/t?tags=d,e, pricing");
    expect(resubmitText(r, [bad(0), ok(1)])).toBe("https://x.org/s?tags=a,b,c");
  });
});

describe("summarizeBulkResult", () => {
  const batch = parseBulkRows(LIST);
  const created = (index: number, slug: string): BulkOutcome => ({ ok: true, index, link: { domain: "snap.to", slug } });
  const failed = (index: number, destination: string, error: string): BulkOutcome => ({ ok: false, index, destination, error });
  const REPORTED: BulkOutcome[] = [
    created(0, "gen1"),
    created(1, "summer-sale"),
    failed(2, "not a url", "destination: Enter an absolute http(s) URL"),
    created(3, "gen2"),
    failed(4, "https://acme.com/winter", "snap.to/taken already exists."),
  ];

  it("the reported shape: 3 created, 2 failed, the text holds just the failures", () => {
    const { text, report } = summarizeBulkResult(batch, REPORTED);
    expect(text).toBe(["not a url", "https://acme.com/winter, taken"].join("\n"));
    expect(report.created).toBe(3);
    expect(report.failed).toBe(2);
  });

  it("keeps submitted order, and numbers failures by their line in the NEW text", () => {
    const { report } = summarizeBulkResult(batch, REPORTED);
    expect(report.items).toEqual([
      { kind: "created", domain: "snap.to", slug: "gen1" },
      { kind: "created", domain: "snap.to", slug: "summer-sale" },
      { kind: "failed", line: 1, destination: "not a url", error: "destination: Enter an absolute http(s) URL" },
      { kind: "created", domain: "snap.to", slug: "gen2" },
      { kind: "failed", line: 2, destination: "https://acme.com/winter", error: "snap.to/taken already exists." },
    ]);
  });

  it("everything created: empty text, no failures", () => {
    const { text, report } = summarizeBulkResult(batch.slice(0, 2), [created(0, "a"), created(1, "b")]);
    expect(text).toBe("");
    expect(report).toMatchObject({ created: 2, failed: 0 });
  });

  it("everything failed: the text is the whole list again, lines numbered 1..n", () => {
    const outs = batch.map((b, i) => failed(i, b.destination, "nope"));
    const { text, report } = summarizeBulkResult(batch, outs);
    expect(text).toBe(LIST);
    expect(report.created).toBe(0);
    expect(report.items.map((i) => (i.kind === "failed" ? i.line : 0))).toEqual([1, 2, 3, 4, 5]);
  });

  it("a row the response skipped is kept, flagged as unreported, and counted as not created", () => {
    const { text, report } = summarizeBulkResult(batch.slice(0, 2), [created(0, "a")]);
    expect(text).toBe("https://acme.com/summer, summer-sale");
    expect(report.items[1]).toEqual({
      kind: "failed",
      line: 1,
      destination: "https://acme.com/summer",
      error: UNREPORTED_ROW_ERROR,
    });
    expect(report.failed).toBe(1);
  });

  it("falls back to the typed destination when the server echoed an empty one", () => {
    const { report } = summarizeBulkResult(batch.slice(0, 1), [failed(0, "", "bad")]);
    expect(report.items[0]).toMatchObject({ kind: "failed", destination: "https://acme.com/spring" });
  });

  it("identical lines are reported per row, not merged", () => {
    const dup = parseBulkRows("https://acme.com/same\nhttps://acme.com/same");
    const { text, report } = summarizeBulkResult(dup, [created(0, "g1"), failed(1, "https://acme.com/same", "nope")]);
    expect(text).toBe("https://acme.com/same");
    expect(report.items.map((i) => i.kind)).toEqual(["created", "failed"]);
  });
});
