import { z } from "zod";

/* ============================================================
   Links, routing rules, and the inputs that create and edit them.

   This file began life as web/src/lib/api/types.ts. Everything the
   frontend already relied on is preserved byte-for-byte; the
   additions are marked with the gap they close (see docs/DECISIONS.md).
   ============================================================ */

export const RedirectType = z.enum(["301", "302", "307"]);
export type RedirectType = z.infer<typeof RedirectType>;

export const LinkStatus = z.enum(["active", "scheduled", "expiring", "expired", "archived"]);
export type LinkStatus = z.infer<typeof LinkStatus>;

export const DeviceType = z.enum(["ios", "android", "desktop", "mobile"]);
export type DeviceType = z.infer<typeof DeviceType>;

/** One rule in a link's routing chain. First match wins. */
export const RoutingRule = z.object({
  id: z.string(),
  when: z.object({
    country: z.string().nullable().optional(),
    device: DeviceType.nullable().optional(),
    language: z.string().nullable().optional(),
  }),
  then: z.string().url(),
  weight: z.number().min(0).max(100).nullable().optional(),
});
export type RoutingRule = z.infer<typeof RoutingRule>;

export const SafeBrowsingStatus = z.enum(["clean", "flagged", "pending"]);
export type SafeBrowsingStatus = z.infer<typeof SafeBrowsingStatus>;

export const Link = z.object({
  id: z.string(),
  domain: z.string(),
  slug: z.string(),
  destination: z.string(),
  title: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  folder: z.string().nullable().optional(),
  status: LinkStatus,
  clicks: z.number(),
  uniqueClicks: z.number().nullable().optional(),
  redirectType: RedirectType.default("302"),
  rules: z.array(RoutingRule).default([]),
  expiresAt: z.string().nullable().optional(),
  /** G5 — was write-only on CreateLinkInput, so it could never be read back or edited. */
  expiresTo: z.string().nullable().optional(),
  /**
   * When the link starts working. Null means "already live".
   *
   * The mirror of `expiresAt`, and like it, nothing runs to make it happen:
   * `deriveStatus` computes the status from the clock every time it is asked,
   * so a link scheduled for Friday goes live on Friday whether or not any
   * process was alive to notice.
   */
  activatesAt: z.string().nullable().optional(),
  /**
   * Where a click lands *before* `activatesAt`.
   *
   * Named for the status rather than the field, which is the only reading that
   * stays straight: a link in status `scheduled` sends clicks to `scheduledTo`,
   * one in status `expired` sends them to `expiresTo`. Null means the visitor
   * gets a plain "not live yet" page instead.
   */
  scheduledTo: z.string().nullable().optional(),
  clickLimit: z.number().nullable().optional(),
  passwordProtected: z.boolean().default(false),
  forwardQuery: z.boolean().default(true),
  deepLink: z.boolean().default(false),
  hideReferrer: z.boolean().default(false),
  publicPreview: z.boolean().default(true),
  cloaked: z.boolean().default(false),
  safeBrowsing: z.object({
    status: SafeBrowsingStatus,
    checkedAt: z.string(),
  }),
  utm: z
    .object({
      source: z.string().nullable().optional(),
      medium: z.string().nullable().optional(),
      campaign: z.string().nullable().optional(),
      content: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  social: z
    .object({
      title: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      image: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  /** G8 — always exactly 30 entries, oldest first, zero-filled. */
  sparkline: z.array(z.number()).default([]),
  createdAt: z.string(),
  createdBy: z.string().nullable().optional(),
});
export type Link = z.infer<typeof Link>;

export const CreateLinkInput = z.object({
  destination: z.string().min(1, "Where should this link go?").url("That doesn't look like a URL — include https://"),
  domain: z.string().min(1),
  slug: z
    .string()
    .regex(/^[a-zA-Z0-9._-]*$/, "Use letters, numbers, dots, dashes or underscores")
    .optional()
    .or(z.literal("")),
  tags: z.array(z.string()).default([]),
  folder: z.string().optional(),
  comment: z.string().max(280).optional(),
  redirectType: RedirectType.default("302"),
  rules: z.array(RoutingRule).default([]),
  expiresAt: z.string().nullable().optional(),
  expiresTo: z.string().nullable().optional(),
  activatesAt: z.string().nullable().optional(),
  scheduledTo: z.string().nullable().optional(),
  clickLimit: z.number().nullable().optional(),
  password: z.string().nullable().optional(),
  forwardQuery: z.boolean().default(true),
  deepLink: z.boolean().default(false),
  hideReferrer: z.boolean().default(false),
  publicPreview: z.boolean().default(true),
  utm: z
    .object({
      source: z.string().optional(),
      medium: z.string().optional(),
      campaign: z.string().optional(),
      content: z.string().optional(),
    })
    .optional(),
  social: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      image: z.string().optional(),
    })
    .optional(),
});
export type CreateLinkInput = z.output<typeof CreateLinkInput>;

/** What the form holds before zod applies its .default() values. react-hook-form
 *  needs this as its value type or every defaulted field reads as possibly-undefined. */
export type CreateLinkFormValues = z.input<typeof CreateLinkInput>;

/* G1 — PATCH /links/:id.

   Deliberately omits `domain` and `slug`. Moving a link to a new slug breaks
   every printed QR code and shared copy of the old one, so it is not something
   you should be able to do by accident in a partial update. If it is ever
   wanted it belongs behind an explicit POST /links/:id/move that forces a
   decision about what the old slug does. */
export const UpdateLinkInput = CreateLinkInput.omit({ domain: true, slug: true })
  .partial()
  .extend({
    /** Null clears the password; undefined leaves it alone. */
    password: z.string().nullable().optional(),
    archived: z.boolean().optional(),
  });
export type UpdateLinkInput = z.infer<typeof UpdateLinkInput>;

/**
 * Duplicate an existing link under a new back-half.
 *
 * Everything that decides where a visitor lands is copied — destination,
 * routing chain, UTM, redirect type, the whole expiry and activation window.
 * What is deliberately not copied is anything that would be a lie on a new
 * link: click counts start at zero, and the clone is never archived even if
 * its source was.
 *
 * `password` follows the same tri-state as UpdateLinkInput, and the default
 * matters: **omitted inherits the original's protection**. Dropping it would
 * mean duplicating a private beta link and quietly publishing an open one.
 * Pass `null` to deliberately remove it.
 */
export const CloneLinkInput = z.object({
  slug: z
    .string()
    .regex(/^[a-zA-Z0-9._-]*$/, "Use letters, numbers, dots, dashes or underscores")
    .optional()
    .or(z.literal("")),
  /** Defaults to the source link's domain. */
  domain: z.string().min(1).optional(),
  password: z.string().nullable().optional(),
});
export type CloneLinkInput = z.infer<typeof CloneLinkInput>;

/* G4 — cursor pagination.

   `total` on its own implied a page that the request had no way to ask for.
   Cursor rather than offset because links are created continuously: with
   OFFSET, inserting a row mid-pagination shifts everything after it and the
   reader silently skips one. */
export const LinkList = z.object({
  items: z.array(Link),
  total: z.number(),
  nextCursor: z.string().nullable().optional(),
});
export type LinkList = z.infer<typeof LinkList>;

export const ListLinksQuery = z.object({
  status: z.enum(["all", "active", "scheduled", "expiring", "expired", "archived"]).default("all"),
  search: z.string().optional(),
  tag: z.string().optional(),
  folder: z.string().optional(),
  domain: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type ListLinksQuery = z.infer<typeof ListLinksQuery>;
