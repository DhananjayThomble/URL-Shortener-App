import { z } from "zod";
import { refs, route } from "../registry.js";

/* #968 — platform-admin routes. GET /admin/me was the foundation; #973 adds the
   platform-wide analytics read + its per-view CSV export. Later parts of the
   epic (#975) register their routes here as they land. */
route({
  method: "get",
  path: "/admin/me",
  tag: "Admin",
  summary: "The current platform admin",
  responses: {
    200: { description: "The confirmed platform admin", schema: refs.AdminMe },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "get",
  path: "/admin/analytics",
  tag: "Admin",
  summary: "Platform-wide analytics (growth, usage, business, email, abuse)",
  query: refs.AdminAnalyticsQuery,
  responses: {
    200: { description: "Platform analytics for the range", schema: refs.PlatformAnalytics },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "get",
  path: "/admin/analytics/export/{view}",
  tag: "Admin",
  summary: "CSV export of one platform-analytics view",
  params: z.object({
    view: z
      .enum(["growth", "usage", "business", "abuse", "topWorkspaces", "topLinks"])
      .describe("Which view to export"),
  }),
  query: refs.AdminAnalyticsQuery,
  responses: {
    200: { description: "CSV export", contentType: "text/csv", schema: z.string() },
    403: { description: "The caller is not a platform admin" },
  },
});
