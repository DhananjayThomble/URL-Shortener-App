import type { CreateLinkInput } from "@snapurl/contract";
import type { MappedRow } from "./types";

/** The /links/bulk hard cap. Each row costs a Safe Browsing lookup server-side,
 *  so the endpoint rejects a batch over this size — we chunk to stay under it. */
export const BATCH_SIZE = 100;

/** SnapURL `comment` max length (packages/contract CreateLinkInput). A source
 *  "title" longer than this is truncated and flagged approximate in the UI. */
export const COMMENT_MAX = 280;

/** The slug shape the contract accepts. A source back-half that does not match
 *  cannot be requested verbatim; rather than fail the all-or-nothing batch, we
 *  drop the slug and let the server generate one (surfaced as "kept, new
 *  back-half"). */
const SLUG_RE = /^[a-zA-Z0-9._-]*$/;

export interface PreparedRow {
  input: CreateLinkInput;
  /** The row's index in the source file, carried so the result UI can name it. */
  sourceIndex: number;
  /** True when we had to drop an invalid requested slug and let the server
   *  generate one. Surfaced distinctly from a server-side collision skip. */
  slugRewritten: boolean;
}

/**
 * Turn parsed rows into CreateLinkInputs under the approved policies:
 *   - domain: the single workspace domain the user picked (Q4).
 *   - slug: kept if it matches the contract shape; otherwise dropped so the
 *     server generates one (never fails the batch on a bad back-half).
 *   - title → comment, truncated to {@link COMMENT_MAX} (approved title mapping).
 *   - created-at, click history, platform metadata: not carried (Q2 / dropped).
 * Collision-with-existing is NOT handled here — the server skips those rows and
 * the UI surfaces them from the per-row BulkCreateLinksResult.
 */
export function prepareRows(rows: MappedRow[], domain: string): PreparedRow[] {
  return rows.map((r) => {
    const slugOk = Boolean(r.slug) && SLUG_RE.test(r.slug!);
    const comment = r.title ? r.title.slice(0, COMMENT_MAX) : undefined;
    const input: CreateLinkInput = {
      destination: r.destination,
      domain,
      ...(slugOk ? { slug: r.slug } : {}),
      tags: r.tags ?? [],
      ...(comment ? { comment } : {}),
      ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}),
      redirectType: "302",
      rules: [],
      forwardQuery: true,
      deepLink: false,
      hideReferrer: false,
      publicPreview: true,
    } as CreateLinkInput;
    return { input, sourceIndex: r.sourceIndex, slugRewritten: Boolean(r.slug) && !slugOk };
  });
}

/** Split prepared rows into ≤{@link BATCH_SIZE} chunks for sequential submit. */
export function chunk<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
