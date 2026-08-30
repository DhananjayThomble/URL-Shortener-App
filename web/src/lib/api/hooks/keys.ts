/* Query keys live in one place so invalidation can't drift from fetching.

   The list keys are prefixes on purpose: a mutation invalidates ["links"] and
   every filtered variant goes stale with it, which is what you want after a
   create or a delete. */
export const qk = {
  me: ["me"] as const,
  workspace: ["workspace"] as const,
  links: (filter?: string) => ["links", filter ?? "all"] as const,
  link: (id: string) => ["link", id] as const,
  forms: () => ["forms"] as const,
  form: (id: string) => ["form", id] as const,
  formResponses: (id: string) => ["form", id, "responses"] as const,
  publicForm: (slug: string) => ["public-form", slug] as const,
  analytics: (range: string, linkId?: string) => ["analytics", range, linkId ?? "workspace"] as const,
  domains: ["domains"] as const,
  members: ["members"] as const,
  audit: ["audit"] as const,
  apiKeys: ["api-keys"] as const,
  webhooks: ["webhooks"] as const,
  bioPages: ["bio-pages"] as const,
  conversions: (range: string) => ["conversions", range] as const,
  preview: (slug: string) => ["preview", slug] as const,
  reports: ["reports"] as const,
};
