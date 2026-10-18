import { UpsertBioPageInput } from "@snapurl/contract";

/* #788 — the pure decisions the bio editor and the public bio page share. */

/** The value to put in an `<a href>`, or null when it must not become a link.
 *
 *  The API validates block URLs on save (contract HttpUrl), so on the public
 *  page this is defence in depth. In the editor it is the only guard: the draft
 *  holds whatever is being typed — `javascript:…`, `data:…`, half a URL — and
 *  the preview must never turn that into something a click can run. Only an
 *  absolute http(s) URL passes; the original string is returned unchanged so
 *  what is shown is what is stored. */
export function safeHttpHref(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? value : null;
}

export type BioBlockErrors = { title?: string; href?: string };

export type BioInputErrors = {
  profile: { name?: string; bio?: string };
  /** Keyed by the block's index in `input.blocks`. Only blocks with a problem appear. */
  blocks: Record<number, BioBlockErrors>;
  /** A complaint about the page as a whole (e.g. too many blocks). */
  other: string | null;
  /** How many fields are wrong, for "fix 2 problems". */
  count: number;
};

/** Every problem the contract finds in a page, each attached to the field it is
 *  about. The contract stays the only validator: this just files its complaints
 *  (the first per field) instead of reporting only the first one overall. */
export function bioInputErrors(input: unknown): BioInputErrors {
  const out: BioInputErrors = { profile: {}, blocks: {}, other: null, count: 0 };
  const parsed = UpsertBioPageInput.safeParse(input);
  if (parsed.success) return out;

  for (const issue of parsed.error.issues) {
    const [head, index, field] = issue.path;
    if (head === "blocks" && typeof index === "number" && (field === "title" || field === "href")) {
      const slot = (out.blocks[index] ??= {});
      if (!slot[field]) {
        slot[field] = issue.message;
        out.count++;
      }
    } else if (head === "profile" && (index === "name" || index === "bio")) {
      if (!out.profile[index]) {
        out.profile[index] = issue.message;
        out.count++;
      }
    } else if (!out.other) {
      out.other = issue.message;
      out.count++;
    }
  }
  return out;
}
