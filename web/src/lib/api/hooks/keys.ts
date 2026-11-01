/* Query keys live in one place so invalidation can't drift from fetching.

   The list keys are prefixes on purpose: a mutation invalidates ["links"] and
   every filtered variant goes stale with it, which is what you want after a
   create or a delete. */
export const qk = {
  me: ["me"] as const,
  adminMe: ["admin-me"] as const,
  /* #969 — admin users & workspaces. List keys are serialised prefixes so a
     mutation invalidating ["admin-users"] clears every filtered variant. */
  adminUsers: (q?: string) => ["admin-users", q ?? "all"] as const,
  adminUser: (id: string) => ["admin-user", id] as const,
  adminWorkspaces: (q?: string) => ["admin-workspaces", q ?? "all"] as const,
  adminWorkspace: (id: string) => ["admin-workspace", id] as const,
  adminWorkspaceViewAs: (id: string) => ["admin-workspace", id, "view-as"] as const,
  // #974 — admin system health and operations.
  adminServices: ["admin-services"] as const,
  adminBacklogs: ["admin-backlogs"] as const,
  // #972 — runtime platform settings + the public banner read.
  adminSettings: ["admin-settings"] as const,
  platformBanner: ["platform-banner"] as const,
  adminAudit: (filter?: string) => ["admin-audit", filter ?? "all"] as const,
  adminWorkspaceAudit: (workspaceId: string, filter?: string) =>
    ["admin-workspace-audit", workspaceId, filter ?? "all"] as const,
  workspace: ["workspace"] as const,
  myWorkspaces: ["my-workspaces"] as const,
  links: (filter?: string) => ["links", filter ?? "all"] as const,
  link: (id: string) => ["link", id] as const,
  forms: () => ["forms"] as const,
  form: (id: string) => ["form", id] as const,
  formResponses: (id: string) => ["form", id, "responses"] as const,
  publicForm: (slug: string) => ["public-form", slug] as const,
  publicBioPage: (slug: string) => ["public-bio-page", slug] as const,
  publicBioPageByDomain: (domain: string, slug: string) => ["public-bio-page", domain, slug] as const,
  analytics: (range: string, linkId?: string) => ["analytics", range, linkId ?? "workspace"] as const,
  domains: ["domains"] as const,
  members: ["members"] as const,
  audit: ["audit"] as const,
  apiKeys: ["api-keys"] as const,
  webhooks: ["webhooks"] as const,
  bioPages: ["bio-pages"] as const,
  conversions: (range: string) => ["conversions", range] as const,
  preview: (slug: string, host?: string) => ["preview", slug, host ?? ""] as const,
  lock: (slug: string, host?: string) => ["lock", slug, host ?? ""] as const,
  reports: ["reports"] as const,
};
