/* Pure UTM builder.
 *
 * Maps the popup's four UTM form fields to the `utm` object CreateLinkInput
 * accepts (`@snapurl/contract` link.ts: source/medium/campaign/content, each an
 * optional string). Empty / whitespace-only fields are dropped so we never send
 * blank tags, and if every field is empty the whole `utm` object is omitted —
 * the create body then carries no `utm` key at all. No DOM, fully unit-testable.
 */

/** The raw strings the four popup inputs hold. */
export interface UtmFields {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

/** The shape CreateLinkInput.utm expects — every field an optional non-empty string. */
export interface UtmObject {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

const KEYS = ["source", "medium", "campaign", "content"] as const;

/**
 * Build a `utm` object from the form fields, or `undefined` when nothing was
 * entered. Trims each value and drops empties, so a partially-filled form yields
 * only the fields the user actually typed.
 */
export function buildUtm(fields: UtmFields): UtmObject | undefined {
  const utm: UtmObject = {};
  for (const key of KEYS) {
    const value = fields[key]?.trim();
    if (value) utm[key] = value;
  }
  return Object.keys(utm).length > 0 ? utm : undefined;
}
