import fc from "fast-check";
import { z } from "zod";
import { HttpUrl, LinkDateInput, UpdateDomainInput } from "@snapurl/contract";

/* ============================================================
   A zod -> fast-check generator for the contract schemas (F1/F2).

   `validArb(schema)` yields values that MUST pass `schema.safeParse`;
   `invalidArb(schema)` yields values that MUST fail it. The pair is its own
   oracle: `zod-arbitrary.test.ts` asserts exactly that over every request
   schema the OpenAPI registry binds, which is what makes the generator
   trustworthy enough to drive the HTTP fuzzer (F3) that builds on it.

   It walks zod v4's internal `_zod.def` (zod@4.x). Every construct the contract
   actually uses is handled explicitly; ANY other construct THROWS, naming the
   path. A silent `fc.anything()` fallback is deliberately refused: it would
   produce junk that parses as "coverage" while generating nothing meaningful,
   which is the failure mode F2 exists to prevent.

   Two things a structural walk cannot see, so they are handled by identity, not
   by shape:
     - `.refine()` surfaces only as an opaque `custom` check on the base type.
       A refinement's predicate is a closure the walker cannot read, so a
       schema carrying one that is NOT in `OVERRIDES` throws rather than emit
       values the refinement would reject.
     - The override map keys arbitraries on schema IDENTITY (`=== HttpUrl`),
       because `HttpUrl` and `LinkDateInput` are the SAME object wherever the
       contract reuses them (verified), and an object-level rule like the one on
       `UpdateDomainInput` lives on the object node itself.
   ============================================================ */

/** A zod v4 schema with its internal def exposed. */
type AnyZod = z.ZodType & { _zod: { def: ZodDef } };

interface CheckDef {
  check?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  length?: number;
  value?: number;
  inclusive?: boolean;
  pattern?: RegExp;
}

interface ZodDef {
  type: string;
  checks?: Array<{ _zod: { def: CheckDef } }>;
  // string
  format?: string;
  // enum
  entries?: Record<string, string | number>;
  // literal
  values?: Array<string | number | boolean | null | undefined>;
  // array
  element?: AnyZod;
  // object
  shape?: Record<string, AnyZod>;
  catchall?: AnyZod;
  // optional / nullable / default
  innerType?: AnyZod;
  defaultValue?: unknown;
  // record
  keyType?: AnyZod;
  valueType?: AnyZod;
  // union / discriminatedUnion
  options?: AnyZod[];
  discriminator?: string;
  // pipe
  in?: AnyZod;
  out?: AnyZod;
  // coerce
  coerce?: boolean;
}

function def(schema: AnyZod): ZodDef {
  return schema._zod.def;
}

/** Thrown when the walker meets a construct it does not model. The message
 *  names the schema path so the gap is actionable, never silent. */
export class UnsupportedSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSchemaError";
  }
}

/* ---------- shared string/number check readers ---------- */

function stringChecks(d: ZodDef): {
  minLength?: number;
  maxLength?: number;
  length?: number;
  format?: string;
  regex?: RegExp;
  trim: boolean;
  hasCustom: boolean;
} {
  const out: ReturnType<typeof stringChecks> = { trim: false, hasCustom: false };
  if (d.format) out.format = d.format; // z.url() carries format on the def itself
  for (const c of d.checks ?? []) {
    const cd = c._zod.def;
    switch (cd.check) {
      case "min_length":
        out.minLength = cd.minimum;
        break;
      case "max_length":
        out.maxLength = cd.maximum;
        break;
      case "length_equals":
        out.length = cd.length;
        break;
      case "string_format":
        if (cd.format === "regex" && cd.pattern) out.regex = cd.pattern;
        else if (cd.format) out.format = cd.format;
        break;
      case "overwrite":
        // `.trim()` (and other string transforms) land as an "overwrite" check.
        // Treated as trim: it shrinks a whitespace-only string, which would then
        // miss a min_length bound, so generated strings must not be whitespace.
        out.trim = true;
        break;
      case "custom":
        out.hasCustom = true;
        break;
      default:
        break;
    }
  }
  return out;
}

function numberChecks(d: ZodDef): {
  int: boolean;
  gte?: number;
  gt?: number;
  lte?: number;
  lt?: number;
  coerce: boolean;
  hasCustom: boolean;
} {
  const out: ReturnType<typeof numberChecks> = { int: false, coerce: d.coerce === true, hasCustom: false };
  for (const c of d.checks ?? []) {
    const cd = c._zod.def;
    switch (cd.check) {
      case "number_format":
        if (cd.format === "safeint" || cd.format === "int32" || cd.format === "int") out.int = true;
        break;
      case "greater_than":
        if (cd.inclusive) out.gte = cd.value;
        else out.gt = cd.value;
        break;
      case "less_than":
        if (cd.inclusive) out.lte = cd.value;
        else out.lt = cd.value;
        break;
      case "custom":
        out.hasCustom = true;
        break;
      default:
        break;
    }
  }
  return out;
}

/* ---------- override arbitraries (refinements the walker can't see) ---------- */

/** A safe http(s) URL the SSRF guard accepts: only example.com/org/net, never a
 *  random host (requirements §5 — the API does a real DNS lookup). */
const safeHttpUrlArb: fc.Arbitrary<string> = fc
  .record({
    scheme: fc.constantFrom("https", "http"),
    host: fc.constantFrom("example.com", "example.org", "example.net"),
    path: fc.webPath(),
    query: fc.option(
      fc
        .array(fc.tuple(fc.stringMatching(/^[a-z]{1,8}$/), fc.stringMatching(/^[a-z0-9]{1,8}$/)), {
          minLength: 1,
          maxLength: 3,
        })
        .map((pairs) => "?" + pairs.map(([k, v]) => `${k}=${v}`).join("&")),
      { nil: "" },
    ),
  })
  .map(({ scheme, host, path, query }) => `${scheme}://${host}${path}${query}`);

/** ISO-8601 instants within ±5 years, for `LinkDateInput` (link.ts:76). */
const linkDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000),
    max: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());

/** Hostile hosts the SSRF guard must reject, for invalid-mode `HttpUrl`. The
 *  same families the hand-written denied-host arbitraries in
 *  `packages/contract/src/schemas.property.test.ts` exercise. */
const octet = fc.integer({ min: 0, max: 255 });
const deniedHostArb: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(fc.constant(10), octet, octet, octet).map((o) => o.join(".")),
  fc.tuple(fc.constant(127), octet, octet, octet).map((o) => o.join(".")),
  fc.tuple(fc.constant(169), fc.constant(254), octet, octet).map((o) => o.join(".")),
  fc.tuple(fc.constant(192), fc.constant(168), octet, octet).map((o) => o.join(".")),
  fc.tuple(fc.constant(172), fc.integer({ min: 16, max: 31 }), octet, octet).map((o) => o.join(".")),
  fc.constantFrom("localhost", "a.localhost", "[::1]", "[fe80::1]", "[fd00::1]"),
);
/** Invalid `HttpUrl` strings: a hostile host, or a non-http(s) scheme. */
const hostileHttpUrlArb: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(fc.constantFrom("http", "https"), deniedHostArb).map(([s, h]) => `${s}://${h}/path`),
  fc.constantFrom(
    "javascript:alert(1)",
    "data:text/html;base64,PHM+",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "not-a-url",
    "http://user:pass@example.com/", // embedded credentials: refused
  ),
);

interface Override {
  valid: fc.Arbitrary<unknown>;
  invalid: fc.Arbitrary<unknown>;
}

/** A safe URL, or null (both accepted for a nullable optional redirect field). */
const redirectFieldArb = fc.oneof(safeHttpUrlArb, fc.constant(null));

/* The object-level rule on `UpdateDomainInput` (workspace.ts): `.strict()`, and
   at least one of `rootRedirect` / `notFoundRedirect` must be present (null is
   "clear", undefined is "leave alone"). A generic object walk cannot see the
   refine, so both modes are built by hand. */
const updateDomainValidArb = fc
  .record(
    { rootRedirect: redirectFieldArb, notFoundRedirect: redirectFieldArb },
    { requiredKeys: [] },
  )
  .map((obj) => {
    // The refine needs at least one key actually present. Guarantee it.
    if (!("rootRedirect" in obj) && !("notFoundRedirect" in obj)) {
      return { rootRedirect: null };
    }
    return obj;
  });

const updateDomainInvalidArb = fc.oneof(
  fc.constant({}), // neither field present -> fails the refine
  fc.constant({ rootRedirect: "http://127.0.0.1/x" }), // hostile URL
  fc.constant({ notFoundRedirect: "javascript:alert(1)" }),
  fc.record({ rootRedirect: safeHttpUrlArb, unknownKey: fc.constant("x") }), // strict: unknown key
  fc.oneof(fc.string(), fc.integer(), fc.constant(null)), // not an object
);

const OVERRIDE_LIST: Array<{ schema: z.ZodType; override: Override }> = [
  { schema: HttpUrl, override: { valid: safeHttpUrlArb, invalid: hostileHttpUrlArb } },
  {
    schema: LinkDateInput,
    override: {
      valid: fc.oneof(linkDateArb, fc.constant("")),
      // Not a readable date, and not "" (which is valid): link.ts isReadableDate.
      invalid: fc.constantFrom("not-a-date", "2026-02-31", "32/13/2026", "yesterday", "nope"),
    },
  },
  { schema: UpdateDomainInput, override: { valid: updateDomainValidArb, invalid: updateDomainInvalidArb } },
];

/* Overrides are resolved by the identity of the schema's internal `_zod.def`,
   NOT the schema object. The registry's `register()` returns `schema.openapi()`,
   which in zod v4 CLONES the schema but SHARES its `_zod.def` — so the bound
   top-level ref (e.g. `refs.UpdateDomainInput`) is a different object than the
   contract's export yet carries the same def. Keying on the def matches both,
   and also matches a nested reuse (a field whose schema IS `HttpUrl`), because
   zod reuses the one def there too. */
const OVERRIDES_BY_DEF = new Map<ZodDef, Override>(
  OVERRIDE_LIST.map(({ schema, override }) => [(schema as AnyZod)._zod.def, override]),
);

function lookupOverride(schema: AnyZod): Override | undefined {
  return OVERRIDES_BY_DEF.get(schema._zod.def);
}

/* ---------- the walker ---------- */

/**
 * An arbitrary of values that MUST pass `schema.safeParse`.
 * @param schema  a zod v4 schema
 * @param path    dotted path for diagnostics (e.g. "CreateLinkInput.slug")
 */
export function validArb(schema: z.ZodType, path = "<root>"): fc.Arbitrary<unknown> {
  const s = schema as AnyZod;
  const override = lookupOverride(s);
  if (override) return override.valid;

  const d = def(s);

  switch (d.type) {
    case "string":
      return validString(d, path);
    case "number":
      return validNumber(d);
    case "boolean":
      return fc.boolean();
    case "enum": {
      const values = Object.values(d.entries ?? {});
      if (values.length === 0) throw new UnsupportedSchemaError(`empty enum at ${path}`);
      return fc.constantFrom(...values);
    }
    case "literal": {
      const values = d.values ?? [];
      if (values.length === 0) throw new UnsupportedSchemaError(`empty literal at ${path}`);
      return fc.constantFrom(...values);
    }
    case "array": {
      if (!d.element) throw new UnsupportedSchemaError(`array without element at ${path}`);
      const { minLength, maxLength } = arrayBounds(d);
      return fc.array(validArb(d.element, `${path}[]`), {
        minLength: minLength ?? 0,
        maxLength: maxLength ?? Math.max((minLength ?? 0) + 3, 3),
      });
    }
    case "object":
      return validObject(d, path);
    case "record": {
      if (!d.keyType || !d.valueType) throw new UnsupportedSchemaError(`record missing key/value at ${path}`);
      // keyType is effectively string for every record in the contract.
      return fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), validArb(d.valueType, `${path}{}`), {
        maxKeys: 4,
      });
    }
    case "optional":
      if (!d.innerType) throw new UnsupportedSchemaError(`optional without innerType at ${path}`);
      return fc.option(validArb(d.innerType, path), { nil: undefined, freq: 4 });
    case "nullable":
      if (!d.innerType) throw new UnsupportedSchemaError(`nullable without innerType at ${path}`);
      return fc.option(validArb(d.innerType, path), { nil: null, freq: 4 });
    case "default":
      if (!d.innerType) throw new UnsupportedSchemaError(`default without innerType at ${path}`);
      // A valid value for the inner schema is still valid; omission (undefined)
      // also parses and the default fills in. Exercise both.
      return fc.oneof(validArb(d.innerType, path), fc.constant(undefined));
    case "union": {
      if (!d.options || d.options.length === 0) throw new UnsupportedSchemaError(`empty union at ${path}`);
      return fc.oneof(...d.options.map((o, i) => validArb(o, `${path}|${i}`)));
    }
    case "pipe": {
      // z.string().pipe(HttpUrl) and z.coerce.*: the OUTPUT end is the stricter
      // schema the parse must satisfy, so generate from it (and its override).
      if (!d.out) throw new UnsupportedSchemaError(`pipe without out at ${path}`);
      return validArb(d.out, path);
    }
    case "unknown":
    case "any":
      return fc.jsonValue();
    default:
      throw new UnsupportedSchemaError(`validArb: unsupported zod type "${d.type}" at ${path}`);
  }
}

function validString(d: ZodDef, path: string): fc.Arbitrary<string> {
  const c = stringChecks(d);
  if (c.hasCustom) {
    throw new UnsupportedSchemaError(
      `validArb: string with a .refine()/custom check at ${path} has no override — add it to OVERRIDES`,
    );
  }
  if (c.format === "url") {
    // A plain z.url() with no identity override: still emit a safe URL rather
    // than risk the SSRF guard on a generic one. (No such bare field exists in
    // the contract today; this keeps the generator honest if one is added.)
    return safeHttpUrlArb;
  }
  if (c.format === "email") {
    return emailArb(c.maxLength);
  }
  if (c.format === "uuid" || c.format === "guid") {
    return fc.uuid();
  }
  if (c.regex) {
    return fc.stringMatching(stripUnsupportedFlags(c.regex));
  }
  if (c.length !== undefined) {
    // An exact-length string from non-whitespace chars (safe under `.trim()`).
    return fc.array(nonSpaceChar, { minLength: c.length, maxLength: c.length }).map((cs) => cs.join(""));
  }
  const min = c.minLength ?? 0;
  const max = c.maxLength ?? Math.max(min + 20, 20);
  // When a non-empty minimum is required, or the field is trimmed, the string
  // must not be whitespace-only (which `.trim()` would collapse below the
  // minimum). Build from a non-whitespace alphabet in that case.
  if (c.trim || min > 0) {
    return fc.array(nonSpaceChar, { minLength: Math.max(min, 1), maxLength: Math.max(max, 1) }).map((cs) =>
      cs.join(""),
    );
  }
  return fc.string({ minLength: min, maxLength: max });
}

/** Printable ASCII letters/digits/punctuation, never whitespace — safe to use
 *  where a `.trim()` or a non-empty minimum would reject a blank string. */
const nonSpaceChar = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.".split(""),
);

function validNumber(d: ZodDef): fc.Arbitrary<number> {
  const c = numberChecks(d);
  // Inclusive bounds resolved from gte/gt/lte/lt.
  let min = c.gte ?? (c.gt !== undefined ? c.gt + (c.int ? 1 : Number.EPSILON) : undefined);
  let max = c.lte ?? (c.lt !== undefined ? c.lt - (c.int ? 1 : Number.EPSILON) : undefined);
  if (c.int) {
    const lo = min !== undefined ? Math.ceil(min) : -1_000_000;
    const hi = max !== undefined ? Math.floor(max) : 1_000_000;
    return fc.integer({ min: lo, max: hi });
  }
  min = min ?? -1_000_000;
  max = max ?? 1_000_000;
  return fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
}

function validObject(d: ZodDef, path: string): fc.Arbitrary<Record<string, unknown>> {
  if (hasObjectCustom(d)) {
    throw new UnsupportedSchemaError(
      `validArb: object with an object-level .refine() at ${path} has no override — add it to OVERRIDES`,
    );
  }
  const shape = d.shape ?? {};
  const model: Record<string, fc.Arbitrary<unknown>> = {};
  const requiredKeys: string[] = [];
  for (const [key, child] of Object.entries(shape)) {
    model[key] = validArb(child, `${path}.${key}`);
    // A key may be omitted iff the field accepts `undefined` (optional, default,
    // or an optional branch inside a union). Everything else must be present.
    if (!acceptsUndefined(child)) requiredKeys.push(key);
  }
  return fc.record(model, { requiredKeys });
}

/** An arbitrary of values that MUST fail `schema.safeParse`. One strategy per
 *  sample (design §5): swap a type, drop a required key, violate a bound, add
 *  an unknown key (strict objects only), or a hostile HttpUrl. */
export function invalidArb(schema: z.ZodType, path = "<root>"): fc.Arbitrary<unknown> {
  const s = schema as AnyZod;
  const override = lookupOverride(s);
  if (override) return override.invalid;

  const d = def(s);

  switch (d.type) {
    case "string":
      return invalidString(d, path);
    case "number":
      return invalidNumber(d);
    case "boolean":
      return fc.oneof(fc.string(), fc.integer(), fc.constant(null));
    case "enum": {
      const values = new Set(Object.values(d.entries ?? {}));
      return fc.string({ minLength: 1 }).filter((x) => !values.has(x));
    }
    case "literal": {
      const values = new Set(d.values ?? []);
      return fc.oneof(fc.string(), fc.integer()).filter((x) => !values.has(x as never));
    }
    case "array": {
      if (!d.element) throw new UnsupportedSchemaError(`array without element at ${path}`);
      const { minLength, maxLength } = arrayBounds(d);
      const strategies: fc.Arbitrary<unknown>[] = [
        // not an array at all
        fc.oneof(fc.string(), fc.integer(), fc.object()),
        // an element of the wrong shape
        fc.array(invalidArb(d.element, `${path}[]`), { minLength: 1, maxLength: 3 }),
      ];
      if (minLength && minLength > 0) strategies.push(fc.constant([])); // too short
      if (maxLength !== undefined) {
        strategies.push(
          fc.array(validArb(d.element, `${path}[]`), { minLength: maxLength + 1, maxLength: maxLength + 2 }),
        );
      }
      return fc.oneof(...strategies);
    }
    case "object":
      return invalidObject(d, path);
    case "record": {
      // Not an object, or an object whose value is the wrong type.
      const strategies: fc.Arbitrary<unknown>[] = [fc.oneof(fc.string(), fc.integer(), fc.array(fc.anything()))];
      if (d.valueType && def(d.valueType).type !== "unknown" && def(d.valueType).type !== "any") {
        strategies.push(
          fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), invalidArb(d.valueType, `${path}{}`), {
            minKeys: 1,
            maxKeys: 3,
          }),
        );
      }
      return fc.oneof(...strategies);
    }
    case "optional":
    case "nullable":
    case "default": {
      // undefined/null parse for these wrappers, so an invalid sample must be a
      // value the INNER schema rejects (and is itself neither null nor undefined).
      if (!d.innerType) throw new UnsupportedSchemaError(`wrapper without innerType at ${path}`);
      return invalidArb(d.innerType, path).filter((x) => x !== undefined && x !== null);
    }
    case "union": {
      if (!d.options || d.options.length === 0) throw new UnsupportedSchemaError(`empty union at ${path}`);
      // A value must fail EVERY branch. Intersecting arbitrary invalids across
      // branches is hard in general; a value of a type no branch accepts is a
      // reliable miss for the unions in the contract (string|literal, object
      // unions keyed on a discriminator). Use a structurally-alien value.
      return fc.constantFrom(Symbol.for("x") as unknown, () => 0, new Map()).map(() => ({ __invalid_union__: true }));
    }
    case "pipe": {
      if (!d.out) throw new UnsupportedSchemaError(`pipe without out at ${path}`);
      return invalidArb(d.out, path);
    }
    case "unknown":
    case "any":
      // Nothing fails z.unknown()/z.any(). Caller (object walker) avoids these.
      throw new UnsupportedSchemaError(
        `invalidArb: ${d.type} at ${path} accepts everything — no invalid value exists`,
      );
    default:
      throw new UnsupportedSchemaError(`invalidArb: unsupported zod type "${d.type}" at ${path}`);
  }
}

function invalidString(d: ZodDef, path: string): fc.Arbitrary<unknown> {
  const c = stringChecks(d);
  if (c.hasCustom) {
    throw new UnsupportedSchemaError(
      `invalidArb: string with a .refine()/custom check at ${path} has no override — add it to OVERRIDES`,
    );
  }
  const strategies: fc.Arbitrary<unknown>[] = [
    // wrong type
    fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.anything())),
  ];
  if (c.format === "email") strategies.push(fc.constantFrom("not-an-email", "a@", "@b.com", "a b@c.com", "x"));
  if (c.format === "uuid" || c.format === "guid")
    strategies.push(fc.constantFrom("not-a-uuid", "1234", "", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"));
  if (c.format === "url") strategies.push(hostileHttpUrlArb);
  if (c.regex) {
    // A string the regex rejects: a char class the pattern forbids.
    strategies.push(fc.constantFrom("!!! invalid///", "\u0000bad", "   spaces here   ", "🚫emoji"));
  }
  if (c.minLength !== undefined && c.minLength > 0) {
    strategies.push(fc.constant("")); // too short (unless a format/regex still catches it — still invalid)
  }
  if (c.maxLength !== undefined) {
    strategies.push(fc.constant("x".repeat(c.maxLength + 1)));
  }
  if (c.length !== undefined) {
    strategies.push(fc.constant("x".repeat(c.length + 1)), fc.constant("x".repeat(Math.max(c.length - 1, 0))));
  }
  return fc.oneof(...strategies);
}

function invalidNumber(d: ZodDef): fc.Arbitrary<unknown> {
  const c = numberChecks(d);
  const strategies: fc.Arbitrary<unknown>[] = [];

  if (c.coerce) {
    // `z.coerce.number()` runs `Number(x)` first, so booleans, null, [] and
    // numeric strings all COERCE to a valid number and are NOT invalid. Only a
    // value `Number()` turns into NaN (or, for an int, a non-integer) fails.
    strategies.push(
      fc.constantFrom("abc", "not-a-number", "1.2.3", "12px", "", "   "),
      fc.constant({}),
      fc.constant({ a: 1 }),
      fc.array(fc.integer(), { minLength: 2, maxLength: 3 }), // [1,2] -> NaN
    );
    if (c.int) strategies.push(fc.constant("1.5"), fc.double({ min: 0.1, max: 0.9, noNaN: true }));
  } else {
    strategies.push(fc.oneof(fc.string({ minLength: 1 }), fc.boolean(), fc.constant(null), fc.constant(NaN)));
    if (c.int) strategies.push(fc.double({ min: 0.1, max: 0.9, noNaN: true })); // non-integer
  }

  if (c.gte !== undefined) strategies.push(fc.constant(c.gte - 1));
  if (c.gt !== undefined) strategies.push(fc.constant(c.gt));
  if (c.lte !== undefined) strategies.push(fc.constant(c.lte + 1));
  if (c.lt !== undefined) strategies.push(fc.constant(c.lt));
  return fc.oneof(...strategies);
}

function invalidObject(d: ZodDef, path: string): fc.Arbitrary<unknown> {
  if (hasObjectCustom(d)) {
    throw new UnsupportedSchemaError(
      `invalidArb: object with an object-level .refine() at ${path} has no override — add it to OVERRIDES`,
    );
  }
  const shape = d.shape ?? {};
  const keys = Object.keys(shape);
  const isStrict = d.catchall !== undefined && def(d.catchall).type === "never";

  const strategies: fc.Arbitrary<unknown>[] = [
    // not an object at all — always invalid.
    fc.oneof(fc.string(), fc.integer(), fc.array(fc.anything())),
  ];

  // Drop a required key: a valid model minus one key the schema demands. A key
  // is "required" precisely when the field rejects `undefined` — testing that
  // is exact, unlike a shallow type check (a `.optional().or(...)` field is a
  // union at the top but still accepts undefined, so dropping it stays valid).
  const requiredKeys = keys.filter((k) => !acceptsUndefined(shape[k]!));
  if (requiredKeys.length > 0) {
    strategies.push(
      fc.record(buildValidModel(shape, path)).chain((obj) =>
        fc.constantFrom(...requiredKeys).map((drop) => {
          const copy = { ...(obj as Record<string, unknown>) };
          delete copy[drop];
          return copy;
        }),
      ),
    );
  }

  // Swap one field to a value of a fundamentally WRONG TYPE. A type swap is a
  // reliable failure for every field whose schema is not "accepts everything",
  // whereas a boundary-miss can land back inside the field's domain (e.g. " "
  // still satisfies a bare string().min(1)). The present (non-undefined) value
  // means even an optional field must now match its inner schema.
  const swappableKeys = keys.filter((k) => !acceptsEverything(shape[k]!));
  if (swappableKeys.length > 0) {
    strategies.push(
      fc.constantFrom(...swappableKeys).chain((key) =>
        fc.record(buildValidModel(shape, path)).map((obj) => ({
          ...(obj as Record<string, unknown>),
          [key]: wrongTypeFor(shape[key]!),
        })),
      ),
    );
  }

  // Add an unknown key — ONLY on strict objects. A non-strict object strips
  // unknown keys, so that input is VALID; F2 catches the mistake if this rule
  // is ever broken (which is exactly the "prove it bites" demo in the PR).
  if (isStrict) {
    strategies.push(
      fc
        .record(buildValidModel(shape, path))
        .map((obj) => ({ ...(obj as Record<string, unknown>), __unknown_key__: "x" })),
    );
  }

  return fc.oneof(...strategies);
}

/** A value whose TYPE the given field's schema cannot accept, used to make an
 *  object field reliably invalid. Picks a primitive the inner type rejects. */
function wrongTypeFor(schema: AnyZod): unknown {
  const inner = unwrap(schema);
  const t = def(inner).type;
  switch (t) {
    case "string":
    case "enum":
    case "literal":
      // these want a string (or specific primitive); a plain object is never one
      return { notAString: true };
    case "number":
      // a coercing number swallows many primitives; an object/NaN-producing
      // value is a safe miss either way.
      return { notANumber: true };
    case "boolean":
      return "not-a-boolean";
    case "array":
      return { notAnArray: true };
    case "object":
    case "record":
      return "not-an-object";
    case "union":
    case "pipe":
      // a structurally-alien object fails string|literal unions and pipes-to-URL
      return { __wrong_type__: true };
    default:
      return { __wrong_type__: true };
  }
}

/** True when a field may be omitted — i.e. it parses `undefined`. Exact, so it
 *  correctly classifies `.optional().or(...)` (a union that still takes
 *  undefined) as omittable where a shallow type check would not. */
function acceptsUndefined(schema: AnyZod): boolean {
  return schema.safeParse(undefined).success;
}

/** Strip optional/nullable/default wrappers to the inner schema. */
function unwrap(schema: AnyZod): AnyZod {
  let s = schema;
  let t = def(s).type;
  while ((t === "optional" || t === "nullable" || t === "default") && def(s).innerType) {
    s = def(s).innerType!;
    t = def(s).type;
  }
  return s;
}

/* ---------- helpers ---------- */

function buildValidModel(shape: Record<string, AnyZod>, path: string): Record<string, fc.Arbitrary<unknown>> {
  const model: Record<string, fc.Arbitrary<unknown>> = {};
  for (const [key, child] of Object.entries(shape)) {
    model[key] = validArb(child, `${path}.${key}`);
  }
  return model;
}

function arrayBounds(d: ZodDef): { minLength?: number; maxLength?: number } {
  let minLength: number | undefined;
  let maxLength: number | undefined;
  for (const c of d.checks ?? []) {
    const cd = c._zod.def;
    if (cd.check === "min_length") minLength = cd.minimum;
    if (cd.check === "max_length") maxLength = cd.maximum;
  }
  return { minLength, maxLength };
}

function hasObjectCustom(d: ZodDef): boolean {
  return (d.checks ?? []).some((c) => c._zod.def.check === "custom");
}

/** True when a schema (possibly wrapped) accepts literally any value. */
function acceptsEverything(schema: AnyZod): boolean {
  const d = def(schema);
  if (d.type === "unknown" || d.type === "any") return true;
  if ((d.type === "optional" || d.type === "nullable" || d.type === "default") && d.innerType) {
    return acceptsEverything(d.innerType);
  }
  return false;
}

/** fast-check's `stringMatching` rejects flags other than d/g/m/s/u (notably
 *  `i`). Dropping `i` is safe for the contract's patterns: the generator emits
 *  lowercase output, which the original case-insensitive pattern still matches. */
function stripUnsupportedFlags(re: RegExp): RegExp {
  const flags = [...re.flags].filter((f) => "dgmsu".includes(f)).join("");
  return flags === re.flags ? re : new RegExp(re.source, flags);
}

/** zod's email regex uses lookaheads, which `fc.stringMatching` cannot drive,
 *  so build an address zod accepts from dot-joined alphanumeric labels. Honours
 *  an optional max length. */
function emailArb(maxLength?: number): fc.Arbitrary<string> {
  const label = fc.stringMatching(/^[a-z0-9]{1,10}$/);
  const part = fc.array(label, { minLength: 1, maxLength: 2 }).map((a) => a.join("."));
  const built = fc
    .tuple(part, part, fc.constantFrom("com", "org", "net", "io", "co"))
    .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);
  return maxLength !== undefined ? built.filter((e) => e.length <= maxLength) : built;
}
