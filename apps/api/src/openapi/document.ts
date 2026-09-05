import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "./registry.js";

// Side-effecting imports: each of these calls route(...) against the shared
// registry above when loaded. Nothing here is used directly — the value is
// in having been imported at all before buildOpenApiDocument() runs.
import "./paths/links.js";
import "./paths/analytics.js";
import "./paths/domains.js";
import "./paths/bio-pages.js";
import "./paths/forms.js";
import "./paths/reports.js";
import "./paths/members.js";
import "./paths/developers.js";
import "./paths/auth.js";
import "./paths/workspaces.js";
import "./paths/public.js";
import "./paths/health.js";

/** Built once at boot, from the same env the rest of the app already
 *  validated — this doc's `servers` entry has to match wherever this
 *  process is actually mounted (env.API_PREFIX), or Swagger UI's
 *  "Try it out" would call the wrong path. */
export function buildOpenApiDocument(apiPrefix: string) {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "SnapURL API",
      version: "2.0.0",
      description:
        "Generated from the zod schemas in packages/contract (#339) — the same shapes the API validates against " +
        "and the web app imports, so this document cannot drift from either the way a hand-written one could.",
    },
    servers: [{ url: `/${apiPrefix}` }],
  });
}
