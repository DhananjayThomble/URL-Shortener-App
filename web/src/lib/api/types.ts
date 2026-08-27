import { z } from "zod";

/* ============================================================
   The wire contract with the NestJS API.

   These schemas are the single source of truth for what the
   frontend expects. When the backend changes a payload, change it
   here first — every hook and component derives its types from
   these, so tsc will point at everything that needs updating.
   ============================================================ */

export const RedirectType = z.enum(["301", "302", "307"]);
export type RedirectType = z.infer<typeof RedirectType>;

export const LinkStatus = z.enum(["active", "expiring", "expired", "archived"]);
export type LinkStatus = z.infer<typeof LinkStatus>;

/** One rule in a link's routing chain. First match wins. */
export const RoutingRule = z.object({
  id: z.string(),
  when: z.object({
    country: z.string().nullable().optional(),
    device: z.enum(["ios", "android", "desktop", "mobile"]).nullable().optional(),
    language: z.string().nullable().optional(),
  }),
  then: z.string().url(),
  weight: z.number().min(0).max(100).nullable().optional(),
});
export type RoutingRule = z.infer<typeof RoutingRule>;

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
  clickLimit: z.number().nullable().optional(),
  passwordProtected: z.boolean().default(false),
  forwardQuery: z.boolean().default(true),
  deepLink: z.boolean().default(false),
  hideReferrer: z.boolean().default(false),
  publicPreview: z.boolean().default(true),
  cloaked: z.boolean().default(false),
  safeBrowsing: z.object({
    status: z.enum(["clean", "flagged", "pending"]),
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

export const TimeseriesPoint = z.object({
  date: z.string(),
  clicks: z.number(),
  unique: z.number(),
  scans: z.number().optional(),
});
export type TimeseriesPoint = z.infer<typeof TimeseriesPoint>;

export const Breakdown = z.object({
  label: z.string(),
  value: z.number(),
  icon: z.string().optional(),
});
export type Breakdown = z.infer<typeof Breakdown>;

export const Analytics = z.object({
  totals: z.object({
    clicks: z.number(),
    unique: z.number(),
    scans: z.number(),
    conversions: z.number(),
    blocked: z.number(),
  }),
  deltas: z.object({
    clicks: z.number(),
    unique: z.number(),
    scans: z.number(),
    conversions: z.number(),
  }),
  series: z.array(TimeseriesPoint),
  countries: z.array(Breakdown),
  devices: z.array(Breakdown),
  browsers: z.array(Breakdown),
  referrers: z.array(Breakdown),
  tags: z.array(Breakdown),
  topLinks: z.array(Breakdown),
});
export type Analytics = z.infer<typeof Analytics>;

export const Domain = z.object({
  id: z.string(),
  domain: z.string(),
  status: z.enum(["live", "verifying", "failed"]),
  ssl: z.enum(["active", "pending", "failed"]),
  sslRenewsAt: z.string().nullable().optional(),
  links: z.number(),
  rootRedirect: z.string().nullable(),
  notFoundRedirect: z.string().nullable(),
  dns: z
    .object({ type: z.string(), name: z.string(), value: z.string(), ttl: z.number() })
    .nullable()
    .optional(),
});
export type Domain = z.infer<typeof Domain>;

export const Member = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["owner", "admin", "editor", "viewer"]),
  status: z.enum(["active", "invited"]),
  links: z.number(),
  lastActive: z.string().nullable(),
  twoFactor: z.boolean(),
  initials: z.string(),
});
export type Member = z.infer<typeof Member>;

export const AuditEntry = z.object({
  id: z.string(),
  at: z.string(),
  actor: z.string(),
  action: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const ApiKey = z.object({
  id: z.string(),
  name: z.string(),
  maskedKey: z.string(),
  scopes: z.array(z.string()),
  lastUsed: z.string().nullable(),
});
export type ApiKey = z.infer<typeof ApiKey>;

export const Webhook = z.object({
  id: z.string(),
  endpoint: z.string(),
  events: z.array(z.string()),
  health: z.enum(["healthy", "retrying", "failing"]),
  detail: z.string(),
});
export type Webhook = z.infer<typeof Webhook>;

export const BioBlock = z.object({
  id: z.string(),
  kind: z.enum(["header", "link", "embed", "email", "social"]),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  metric: z.string().nullable().optional(),
  locked: z.boolean().default(false),
});
export type BioBlock = z.infer<typeof BioBlock>;

export const BioPage = z.object({
  id: z.string(),
  domain: z.string(),
  slug: z.string(),
  status: z.enum(["live", "draft"]),
  blocks: z.array(BioBlock),
  views: z.number(),
  clickThrough: z.number().nullable(),
  profile: z.object({ name: z.string(), bio: z.string(), initials: z.string() }),
});
export type BioPage = z.infer<typeof BioPage>;

export const ConversionEvent = z.object({
  id: z.string(),
  kind: z.enum(["lead", "signup", "sale", "custom"]),
  name: z.string(),
  source: z.string(),
  count: z.number(),
});
export type ConversionEvent = z.infer<typeof ConversionEvent>;

export const ConversionsReport = z.object({
  totals: z.object({
    clicks: z.number(),
    leads: z.number(),
    signups: z.number(),
    paid: z.number(),
    revenue: z.number(),
  }),
  deltas: z.object({
    clicks: z.number(),
    leads: z.number(),
    signups: z.number(),
    paid: z.number(),
    revenue: z.number(),
  }),
  events: z.array(ConversionEvent),
  byLink: z.array(
    z.object({
      link: z.string(),
      campaign: z.string(),
      clicks: z.number(),
      signups: z.number(),
      cvr: z.number(),
      revenue: z.number(),
    }),
  ),
  revenueSeries: z.array(z.number()),
});
export type ConversionsReport = z.infer<typeof ConversionsReport>;

export const Workspace = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  initials: z.string(),
  plan: z.string(),
  defaultDomain: z.string(),
  defaultRedirect: RedirectType,
  clicksUsed: z.number(),
  clicksIncluded: z.number(),
  retentionYears: z.number(),
  cookielessAnalytics: z.boolean(),
  scanOnCreate: z.boolean(),
  publicPreviews: z.boolean(),
});
export type Workspace = z.infer<typeof Workspace>;

export const PublicLinkPreview = z.object({
  shortUrl: z.string(),
  destination: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  verifiedDomain: z.boolean(),
  safeBrowsing: z.enum(["clean", "flagged", "pending"]),
  scannedAt: z.string(),
  setsCookies: z.boolean(),
  redirectType: RedirectType,
});
export type PublicLinkPreview = z.infer<typeof PublicLinkPreview>;

export const AuthUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  initials: z.string(),
  role: Member.shape.role,
});
export type AuthUser = z.infer<typeof AuthUser>;

export const AuthSession = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: AuthUser,
});
export type AuthSession = z.infer<typeof AuthSession>;
