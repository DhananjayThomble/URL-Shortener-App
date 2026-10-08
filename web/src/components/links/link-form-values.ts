/* Pure helpers shared by the create/edit link forms (kept free of UI imports so they unit-test cheaply). */

/**
 * `register("expiresTo")` / `register("scheduledTo")` are plain uncontrolled
 * inputs with no default value, so an untouched field reads back as `""`,
 * not `undefined`, once the user has interacted with the form at all (RHF's
 * internal field state initialises an unset text input to the empty
 * string). Both fields are `HttpUrl.nullable().optional()` in the contract
 * (packages/contract/src/link.ts) — `undefined`/`null` mean "no override",
 * but `""` fails HttpUrl's own format check (it isn't a URL at all). So
 * turning on "Expire on a date" / "Go live on a date" and leaving the
 * "send visitors to" field blank always failed validation: silently on
 * create (the resolver rejected the submit with no field-level error wired
 * for either input, so nothing happened and nothing told the user why), and
 * with a visible-but-wrong "Enter an absolute http(s) URL" on edit, pointed
 * at a field that was never shown and never touched.
 *
 * Both drawers run their values through this before handing them to the
 * real contract schema (CreateLinkInput / UpdateLinkInput, untouched), so an
 * empty back-half of either field is treated as "not set".
 */
export function blankOptionalUrlsToUndefined<
  T extends { expiresTo?: unknown; scheduledTo?: unknown; utm?: unknown; social?: unknown },
>(values: T): T {
  /* utm.* and social.* are text inputs too, so a field the user cleared reads
     back as "". Dropping the blank keys is what lets a UTM/preview value be
     REMOVED on edit (the object is replaced wholesale by PATCH) and keeps
     social.image — an HttpUrl — from rejecting an empty string. */
  const withoutBlanks = <O,>(obj: O): O =>
    (obj && typeof obj === "object"
      ? Object.fromEntries(Object.entries(obj as Record<string, unknown>).filter(([, v]) => v !== "" && v != null))
      : obj) as O;
  return {
    ...values,
    expiresTo: values.expiresTo === "" ? undefined : values.expiresTo,
    scheduledTo: values.scheduledTo === "" ? undefined : values.scheduledTo,
    utm: withoutBlanks(values.utm),
    social: withoutBlanks(values.social),
  };
}

/* A native <input type="date"> only understands "YYYY-MM-DD". The link holds a
   full ISO timestamp, so binding the input straight to the form value (as a
   plain register() does) renders blank for every link that already has a date
   — and, worse, hands the user an empty field to "edit". These two convert at
   the boundary, in the viewer's local calendar, and only on change, so an
   untouched date is submitted exactly as the server returned it. */
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** `endOfDay` for expiry ("stops working after the date you pick"), start of day for go-live. */
export function dateInputToIso(value: string, endOfDay: boolean): string | null {
  if (!value) return null;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

