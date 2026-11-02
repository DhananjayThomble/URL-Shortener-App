import { z } from "zod";

/* ============================================================
   #992 §5 — billing details (billing 6/6, epic #991).

   The company identity that goes on an invoice: a billing email the receipt is
   sent to, a company (legal) name, a tax identifier — a GSTIN for an Indian
   business or a generic tax id otherwise — and a billing address. The workspace
   OWNER edits them in Settings; a platform ADMIN can view them; and they are
   attached to the provider's customer / invoice so the PDF the provider raises
   carries them.

   Pure zod so the mutation suite exercises the validation standalone (no DB, no
   provider). Nothing here is a secret: a tax id and an address are the same
   facts that already print on an invoice. Every field is optional — a workspace
   that has entered nothing yet has an all-null record, and the owner fills in
   what applies to them.

   GSTIN format: the 15-character Indian GST identifier — two state-code digits,
   a 10-character PAN (5 letters, 4 digits, 1 letter), an entity digit, the
   literal 'Z', and a checksum character. We validate the SHAPE (so an obvious
   typo is caught at entry) but do not verify the checksum against the GST
   registry — that is the provider's / a later integration's job, and rejecting a
   structurally-valid id here would block a legitimate edit. A non-Indian tax id
   has no single format, so `taxId` is a free, length-capped string and the
   GSTIN shape is enforced only when the country is India (see the refine).
   ============================================================ */

/** The 15-character GSTIN shape: `NN PPPPP NNNN P E Z C` with no spaces.
 *  Upper-cased before the test, so a lower-case entry is accepted and
 *  normalised rather than rejected. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** An ISO-3166-1 alpha-2 country code: two upper-case letters. Kept as a plain
 *  two-letter code (not an enum of every country) so the address stays simple;
 *  "IN" is the one value that also switches on the GSTIN format rule below. */
export const CountryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "A country is a two-letter ISO code, e.g. IN or US.");
export type CountryCode = z.infer<typeof CountryCode>;

/** The billing postal address. Every line is optional and length-capped; an
 *  empty address is all-null. `line1`/`city`/`postalCode`/`country` are the
 *  fields a provider invoice address typically needs; `line2` and `state` are
 *  optional extras. */
export const BillingAddress = z
  .object({
    line1: z.string().trim().max(200).nullish(),
    line2: z.string().trim().max(200).nullish(),
    city: z.string().trim().max(120).nullish(),
    state: z.string().trim().max(120).nullish(),
    postalCode: z.string().trim().max(20).nullish(),
    country: CountryCode.nullish(),
  })
  .strict();
export type BillingAddress = z.infer<typeof BillingAddress>;

/**
 * What the owner submits to set the workspace's billing details. Every field is
 * optional, so the owner can fill in or clear one field at a time; an explicit
 * `null` clears a field. A blank string for a text field is normalised to null
 * (an empty company name is "no company name", not the string "").
 *
 * The GSTIN rule: when the address country is India, a provided `taxId` must
 * match the GSTIN shape — an Indian business's tax id IS its GSTIN, so a
 * malformed one is a typo worth catching. For any other country (or no country)
 * `taxId` is a free string: tax ids vary by jurisdiction and we do not pretend
 * to validate every one.
 */
export const BillingDetailsInput = z
  .object({
    /** Where the invoice/receipt is emailed. A valid email, or null to clear.
     *  Independent of the account's login email — a business often bills to
     *  accounts@. */
    billingEmail: z
      .string()
      .trim()
      .email("Enter a valid billing email.")
      .max(255)
      .nullish(),
    /** The legal/company name that prints on the invoice, or null. */
    companyName: z.string().trim().max(200).nullish(),
    /** The tax identifier (a GSTIN in India, a generic tax id elsewhere), or
     *  null. Upper-cased so a GSTIN compares in one case. */
    taxId: z.string().trim().toUpperCase().max(40).nullish(),
    /** The billing postal address, or null for none. */
    address: BillingAddress.nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const country = v.address?.country ?? null;
    if (country === "IN" && v.taxId != null && v.taxId !== "" && !GSTIN_REGEX.test(v.taxId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taxId"],
        message: "An Indian tax id must be a valid 15-character GSTIN.",
      });
    }
  });
export type BillingDetailsInput = z.infer<typeof BillingDetailsInput>;

/**
 * The workspace's stored billing details, as the owner's GET and the admin view
 * both return them. All fields nullable — a workspace that set nothing reads as
 * an all-null record rather than a 404, so the Settings form always has a shape
 * to bind to. `updatedAt` is null until the details are first set.
 */
export const BillingDetails = z.object({
  billingEmail: z.string().nullable(),
  companyName: z.string().nullable(),
  taxId: z.string().nullable(),
  address: z
    .object({
      line1: z.string().nullable(),
      line2: z.string().nullable(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      postalCode: z.string().nullable(),
      country: z.string().nullable(),
    })
    .nullable(),
  /** ISO-8601 when the details were last set, or null if never. */
  updatedAt: z.string().nullable(),
});
export type BillingDetails = z.infer<typeof BillingDetails>;
