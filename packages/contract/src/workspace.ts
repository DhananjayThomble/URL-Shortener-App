import { z } from "zod";
import { RedirectType } from "./link.js";
import { CurrencyCode } from "./analytics.js";

/* Workspace, domains, team, and the developer surface. */

export const MemberRole = z.enum(["owner", "admin", "editor", "viewer"]);
export type MemberRole = z.infer<typeof MemberRole>;

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
  /** G7 — reports need to say what currency they are in. */
  currency: CurrencyCode.default("INR"),
});
export type Workspace = z.infer<typeof Workspace>;

export const UpdateWorkspaceInput = z
  .object({
    name: z.string().min(1).max(80),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    defaultDomain: z.string(),
    defaultRedirect: RedirectType,
    retentionYears: z.number().int().min(1).max(100),
    cookielessAnalytics: z.boolean(),
    scanOnCreate: z.boolean(),
    publicPreviews: z.boolean(),
    currency: CurrencyCode,
  })
  .partial();
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceInput>;

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

export const AddDomainInput = z.object({
  domain: z
    .string()
    .min(3)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "That doesn't look like a domain name"),
  rootRedirect: z.string().url().nullable().optional(),
  notFoundRedirect: z.string().url().nullable().optional(),
});
export type AddDomainInput = z.infer<typeof AddDomainInput>;

export const Member = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: MemberRole,
  status: z.enum(["active", "invited"]),
  links: z.number(),
  lastActive: z.string().nullable(),
  twoFactor: z.boolean(),
  initials: z.string(),
});
export type Member = z.infer<typeof Member>;

export const InviteMemberInput = z.object({
  email: z.string().email("That doesn't look like an email address"),
  role: MemberRole.exclude(["owner"]).default("editor"),
});
export type InviteMemberInput = z.infer<typeof InviteMemberInput>;

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

export const API_SCOPES = [
  "links:read",
  "links:write",
  "analytics:read",
  "domains:read",
  "domains:write",
  "conversions:write",
] as const;

export const CreateApiKeyInput = z.object({
  name: z.string().min(1).max(60),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInput>;

/** The only time the full key is ever returned. It is stored hashed. */
export const CreatedApiKey = ApiKey.extend({ key: z.string() });
export type CreatedApiKey = z.infer<typeof CreatedApiKey>;

export const WEBHOOK_EVENTS = [
  "link.created",
  "link.updated",
  "link.deleted",
  "link.clicked",
  "conversion.recorded",
  "domain.verified",
] as const;

export const Webhook = z.object({
  id: z.string(),
  endpoint: z.string(),
  events: z.array(z.string()),
  health: z.enum(["healthy", "retrying", "failing"]),
  detail: z.string(),
});
export type Webhook = z.infer<typeof Webhook>;

export const CreateWebhookInput = z.object({
  endpoint: z.string().url("Webhook endpoints must be absolute https URLs"),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});
export type CreateWebhookInput = z.infer<typeof CreateWebhookInput>;

/** The only time the signing secret is ever returned, exactly like CreatedApiKey.
 *  DevelopersService.createWebhook already returns it; without a schema for the
 *  response the frontend would have to hand-copy the shape to read it. */
export const CreatedWebhook = Webhook.extend({ secret: z.string() });
export type CreatedWebhook = z.infer<typeof CreatedWebhook>;

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

export const UpsertBioPageInput = z.object({
  domain: z.string(),
  slug: z.string().regex(/^[a-zA-Z0-9._-]+$/),
  status: z.enum(["live", "draft"]).default("draft"),
  profile: z.object({
    name: z.string().min(1).max(80),
    bio: z.string().max(280).default(""),
  }),
  blocks: z
    .array(
      BioBlock.omit({ id: true }).extend({
        id: z.string().optional(),
        href: z.string().url().optional(),
      }),
    )
    .default([]),
});
export type UpsertBioPageInput = z.infer<typeof UpsertBioPageInput>;
