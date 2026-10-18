import { z } from "zod";

/* ============================================================
   Human validation copy, in ONE place (#792).

   zod's built-in English ("Too big: expected string to have <=80
   characters", "Invalid input: expected string, received undefined",
   "Invalid email address" for an empty box) is written for developers.
   Before this file it reached people verbatim, usually behind a raw
   field path ("name: Too big: …"), from three separate places:

     - the API's ZodValidationPipe (every JSON body / query),
     - the bulk-create service (one safeParse per pasted row),
     - the web forms' own zod resolvers and safeParse calls.

   All three now read their words from here. Messages are written to stand
   alone as a sentence ("Name must be 80 characters or fewer") so they make
   sense both under a form field and in a toast that has no field to point at.

   How it is wired: `z.config({ customError })` is zod's global fallback. It
   sits BELOW every message a schema sets itself (`.min(12, "Use at least…")`,
   HttpUrl's "Enter an absolute http(s) URL"), so hand-written copy always
   wins and this only fills the gaps zod would have filled with its own
   English. It changes wording only — never what is accepted or rejected.

   The registration is a side effect of importing the contract, which both
   apps/api and web already do before any schema runs.
   ============================================================ */

type PathKey = PropertyKey;

/* Names people know a field by, where the camelCase key would read badly
   ("slug" is a "back-half" everywhere in the UI). Anything not listed is
   humanised from its key. */
const FIELD_LABELS: Record<string, string> = {
  destination: "Destination",
  slug: "Back-half",
  domain: "Domain",
  email: "Email",
  password: "Password",
  name: "Name",
  endpoint: "Endpoint URL",
  events: "Events",
  scopes: "Scopes",
  expiresAt: "Expiry date",
  expiresTo: "Expiry redirect",
  activatesAt: "Start date",
  scheduledTo: "Pre-launch redirect",
  clickLimit: "Click limit",
  redirectType: "Redirect type",
  reporterContact: "Contact email",
  retentionYears: "Retention",
  idToken: "Sign-in token",
  then: "Redirect URL",
  image: "Image URL",
  utm: "UTM",
};

function humanise(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : "";
}

/**
 * The name a person would give the field an issue is about, from its path.
 * `["name"]` → "Name"; `["tags", 2]` → "Tags item 3"; `[]` → "".
 */
export function fieldLabel(path: ReadonlyArray<PathKey>): string {
  if (path.length === 0) return "";
  const last = path[path.length - 1]!;
  if (typeof last === "number") {
    const parent = path.length > 1 ? fieldLabel(path.slice(0, -1)) : "";
    return `${parent || "Item"} item ${last + 1}`.replace(/^Item item/, "Item");
  }
  const key = String(last);
  return FIELD_LABELS[key] ?? humanise(key);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The slice of zod's raw issue the wording needs (it also carries `input`). */
export interface RawIssue {
  code?: string;
  origin?: string;
  format?: string;
  expected?: string;
  maximum?: unknown;
  minimum?: unknown;
  inclusive?: boolean;
  divisor?: unknown;
  keys?: unknown;
  input?: unknown;
  path?: ReadonlyArray<PathKey>;
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** A key echoed back in a sentence: quoted, and capped so a hostile 5 MB key is not reflected. */
const MAX_ECHOED_KEY = 40;
const quoteKey = (key: string) => `“${key.length > MAX_ECHOED_KEY ? `${key.slice(0, MAX_ECHOED_KEY)}…` : key}”`;

/**
 * The human sentence for a zod issue that has no message of its own.
 * Exported for the tests and for callers holding a raw issue; everything else
 * gets it through the global `customError` registered below.
 */
export function friendlyIssueMessage(iss: RawIssue): string {
  const label = fieldLabel(iss.path ?? []);
  const subject = label || "This field";
  const lower = label ? label[0]!.toLowerCase() + label.slice(1) : "this field";
  const missing = `${subject} is required`;

  // An empty or absent value is "required" whatever shape rule it also breaks:
  // "Invalid email address" for a box nobody typed in is a lie.
  if (iss.code === "invalid_type" && isBlank(iss.input)) return missing;
  if (iss.code === "invalid_format" && typeof iss.input === "string" && iss.input === "") return missing;

  switch (iss.code) {
    case "invalid_type":
      switch (iss.expected) {
        case "int":
          return `${subject} must be a whole number`;
        case "number":
        case "nan":
          return `${subject} must be a number`;
        case "string":
          return `${subject} must be text`;
        case "boolean":
          return `${subject} must be yes or no`;
        case "array":
          return `${subject} must be a list`;
        default:
          return `${subject} isn't valid`;
      }

    case "too_small": {
      const min = Number(iss.minimum);
      const exclusive = iss.inclusive === false;
      if (iss.origin === "string") {
        // min(1) is zod's spelling of "not empty".
        if (min <= 1 && !exclusive) return missing;
        return `${subject} must be at least ${plural(exclusive ? min + 1 : min, "character", "characters")}`;
      }
      if (iss.origin === "array" || iss.origin === "set") {
        const n = exclusive ? min + 1 : min;
        return n <= 1 ? `${subject} must have at least one item` : `${subject} must have at least ${n} items`;
      }
      return exclusive ? `${subject} must be greater than ${min}` : `${subject} must be at least ${min}`;
    }

    case "too_big": {
      const max = Number(iss.maximum);
      const exclusive = iss.inclusive === false;
      if (iss.origin === "string") {
        return `${subject} must be ${plural(exclusive ? max - 1 : max, "character", "characters")} or fewer`;
      }
      if (iss.origin === "array" || iss.origin === "set") {
        return `${subject} can have at most ${plural(exclusive ? max - 1 : max, "item", "items")}`;
      }
      return exclusive ? `${subject} must be less than ${max}` : `${subject} must be ${max} or less`;
    }

    case "invalid_format":
      switch (iss.format) {
        case "email":
          return "Enter a valid email address";
        case "url":
          return "Enter a valid URL";
        case "uuid":
        case "guid":
          return `${subject} isn't a valid ID`;
        default:
          return `${subject} isn't in a valid format`;
      }

    case "invalid_value":
      return label ? `Choose a valid option for ${lower}` : "Choose one of the available options";

    case "not_multiple_of":
      return `${subject} must be a multiple of ${String(iss.divisor)}`;

    case "unrecognized_keys": {
      const keys = Array.isArray(iss.keys) ? iss.keys.map(String) : [];
      return keys.length > 0
        ? `${keys.map(quoteKey).join(", ")} ${keys.length === 1 ? "isn't a field" : "aren't fields"} we recognise`
        : "That request included something we don't recognise";
    }

    default:
      // invalid_union, custom (a bare .refine with no message), invalid_key, …
      return `${subject} isn't valid`;
  }
}

let installed = false;

/** Idempotent. Registers {@link friendlyIssueMessage} as zod's fallback copy. */
export function installFriendlyValidationMessages(): void {
  if (installed) return;
  installed = true;
  z.config({
    // Only consulted when the schema set no message of its own, so hand-written
    // copy (`.min(12, "Use at least…")`, HttpUrl's) is never overridden.
    customError: (iss) => friendlyIssueMessage(iss as RawIssue),
  });
}

installFriendlyValidationMessages();

/** One validation problem, as the API reports it and the web maps it to a field. */
export interface ValidationIssue {
  path: string;
  message: string;
  /** Set only where a machine client can act on the kind of problem. `path` is then the rejected key. */
  code?: "unrecognized_key";
}

type DedupeInput = { path: ReadonlyArray<PathKey>; message: string; code?: string; keys?: unknown };

/**
 * At most one message per field, in the order the fields were first reported.
 *
 * A single bad value can trip several rules at once — HttpUrl runs its
 * userinfo and host refinements even after "is it a URL at all" failed, so one
 * mistyped destination used to produce three contradictory lines. The first
 * issue for a path is the most fundamental one; the rest are noise.
 *
 * Two exceptions, both because collapsing would hide information:
 *  - a strict object's `unrecognized_keys` sits at the object's own (often
 *    empty) path and lists the offending keys; it is expanded to one issue per
 *    key, with `path` = that key, so a client can see WHICH key was rejected;
 *  - problems with no path at all (a root-level refinement) are only
 *    deduplicated when the message is identical, never merged into one.
 */
export function dedupeIssuesByField(issues: ReadonlyArray<DedupeInput>): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];
  const push = (issue: ValidationIssue) => {
    const id = issue.path === "" ? `\u0000${issue.message}` : issue.path;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(issue);
  };
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys" && Array.isArray(issue.keys) && issue.keys.length > 0) {
      for (const key of issue.keys.map(String)) {
        const path = [...issue.path.map(String), key].join(".");
        push({
          path,
          message: friendlyIssueMessage({ code: "unrecognized_keys", keys: [key], path: issue.path }),
          code: "unrecognized_key",
        });
      }
      continue;
    }
    push({ path: issue.path.map(String).join("."), message: issue.message });
  }
  return out;
}

/**
 * One line of prose for a whole failed parse: the deduped messages, each
 * ending in a full stop, joined by a space. For places that report a problem
 * as a single string (a bulk-create row) rather than a list.
 */
export function issuesToSentence(issues: ReadonlyArray<DedupeInput>): string {
  return dedupeIssuesByField(issues)
    .map(({ message }) => (/[.!?]$/.test(message) ? message : `${message}.`))
    .join(" ");
}

/* ── Messages written by a server that predates this file ────────────────────
   A web bundle and an API are not always deployed in the same minute, and a
   cached tab outlives both. An older API answers `["name: Too big: expected
   string to have <=80 characters"]`; the web client passes each entry through
   {@link friendlyApiMessage} so that skew never puts developer English on
   screen. Only recognised shapes are rewritten — every other message is
   returned untouched. */

const LEGACY_PREFIX = /^([a-z_][\w-]{0,39}(?:\.[\w-]{1,40}){0,4}): (\S.*)$/s;

function fromZodDefault(text: string, path: PathKey[]): RawIssue | null {
  let m = text.match(/^Invalid input: expected (\w+), received (\w+)$/);
  if (m) return { code: "invalid_type", expected: m[1], input: m[2] === "undefined" ? undefined : m[2] === "null" ? null : "x", path };
  m = text.match(/^Too (big|small): expected (\w+) to (?:have|be) ([<>]=?)(\d+(?:\.\d+)?)(?: \w+)?$/);
  if (m) {
    const bound = Number(m[4]);
    const inclusive = m[3]!.endsWith("=");
    return m[1] === "big"
      ? { code: "too_big", origin: m[2], maximum: bound, inclusive, path }
      : { code: "too_small", origin: m[2], minimum: bound, inclusive, path };
  }
  if (text === "Invalid email address") return { code: "invalid_format", format: "email", input: "x", path };
  if (text === "Invalid URL") return { code: "invalid_format", format: "url", input: "x", path };
  if (/^Invalid string: /.test(text)) return { code: "invalid_format", format: "regex", input: "x", path };
  if (/^Invalid option: /.test(text)) return { code: "invalid_value", path };
  if (text === "Invalid input") return { code: "custom", path };
  m = text.match(/^Unrecognized keys?: (.+)$/);
  if (m) {
    const keys = [...m[1]!.matchAll(/"([^"]*)"/g)].map((k) => k[1]!);
    if (keys.length > 0) return { code: "unrecognized_keys", keys, path };
  }
  return null;
}

/**
 * Rewrites one server message into plain English if it is a raw zod message
 * and/or carries a `field.path: ` prefix; otherwise returns it as given.
 */
export function friendlyApiMessage(message: string): string {
  const prefixed = message.match(LEGACY_PREFIX);
  const path = prefixed ? prefixed[1]!.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  const body = prefixed ? prefixed[2]! : message;
  const issue = fromZodDefault(body, path);
  if (issue) return friendlyIssueMessage(issue);
  // `field: Some already-human sentence` — keep the sentence, drop the path.
  return prefixed ? body : message;
}
