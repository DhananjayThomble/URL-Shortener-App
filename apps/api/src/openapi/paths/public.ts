import { z } from "zod";
import { refs, route, SlugParam } from "../registry.js";

const tag = "Public";

/* #972 — the site-wide banner, readable without auth so it shows for every
   visitor. The web app polls it; an empty message means no banner. */
route({
  method: "get",
  path: "/public/platform/banner",
  tag,
  summary: "The current site-wide banner (empty message means none)",
  public: true,
  responses: { 200: { description: "The banner message and level", schema: refs.PlatformBanner } },
});

route({
  method: "get",
  path: "/public/links/{slug}/preview",
  tag,
  summary: "Preview a link's destination before following it",
  public: true,
  params: SlugParam,
  query: z.object({ host: z.string().optional().describe("The domain the slug was resolved on") }),
  responses: { 200: { description: "Preview", schema: refs.PublicLinkPreview } },
});

route({
  method: "get",
  path: "/public/links/{slug}/lock",
  tag,
  summary: "Whether a password guards a link — for the unlock form; not gated by public previews, never the destination",
  public: true,
  params: SlugParam,
  query: z.object({ host: z.string().optional().describe("The domain the slug was resolved on") }),
  responses: { 200: { description: "The short URL and whether it is password protected", schema: refs.PublicLinkLock } },
});

route({
  method: "post",
  path: "/public/links/{slug}/unlock",
  tag,
  summary: "Submit a password for a password-protected link (5/min per IP)",
  public: true,
  params: SlugParam,
  query: z.object({ host: z.string().optional() }),
  body: refs.UnlockLinkInput,
  responses: {
    200: { description: "A short-lived unlock token, scoped to this one link", schema: refs.UnlockLinkResult },
  },
});

route({
  method: "get",
  path: "/public/forms/{slug}",
  tag,
  summary: "Get a published form (404 for draft/closed — existence is not public)",
  public: true,
  params: SlugParam,
  responses: { 200: { description: "The public form definition", schema: refs.PublicForm } },
});

route({
  method: "get",
  path: "/public/bio-pages/by-domain/{domain}/{slug}",
  tag,
  summary: "Get a published bio page by (domain, slug) — the per-domain route (#650)",
  public: true,
  params: SlugParam.extend({ domain: z.string() }),
  responses: { 200: { description: "The public bio page: profile and blocks only", schema: refs.PublicBioPage } },
});

route({
  method: "get",
  path: "/public/bio-pages/{slug}",
  tag,
  summary: "Backward-compatible slug alias (#650) — resolves on the shared/system domain only; 404 for draft/missing or a custom-domain-only slug",
  public: true,
  params: SlugParam,
  responses: { 200: { description: "The public bio page: profile and blocks only", schema: refs.PublicBioPage } },
});

route({
  method: "post",
  path: "/public/bio-pages/by-domain/{domain}/{slug}/view",
  tag,
  summary: "Count one view of a published bio page by (domain, slug) (30/min per IP)",
  public: true,
  params: SlugParam.extend({ domain: z.string() }),
  responses: { 204: { description: "Counted" } },
});

route({
  method: "post",
  path: "/public/bio-pages/by-domain/{domain}/{slug}/blocks/{blockId}/click",
  tag,
  summary: "Count one click on a block by (domain, slug) (30/min per IP)",
  public: true,
  params: SlugParam.extend({ domain: z.string(), blockId: z.uuid() }),
  responses: { 204: { description: "Counted" } },
});

route({
  method: "post",
  path: "/public/bio-pages/{slug}/view",
  tag,
  summary: "Count one view via the slug alias — system domain only (30/min per IP)",
  public: true,
  params: SlugParam,
  responses: { 204: { description: "Counted" } },
});

route({
  method: "post",
  path: "/public/bio-pages/{slug}/blocks/{blockId}/click",
  tag,
  summary: "Count one click via the slug alias — system domain only (30/min per IP)",
  public: true,
  params: SlugParam.extend({ blockId: z.uuid() }),
  responses: { 204: { description: "Counted" } },
});

route({
  method: "post",
  path: "/public/forms/{slug}",
  tag,
  summary: "Submit a form response (10/min per IP)",
  public: true,
  params: SlugParam,
  body: refs.SubmitFormInput,
  responses: {
    200: {
      description: "Always 200 — validation failures are per-field errors in the body, not a 400",
      schema: refs.SubmitFormResult,
    },
  },
});

route({
  method: "post",
  path: "/public/links/{slug}/report",
  tag,
  summary: "Report a link for abuse (10/min per IP)",
  public: true,
  params: SlugParam,
  body: refs.SubmitReportInput,
  responses: {
    200: {
      description: "Always {ok:true} regardless of whether the slug resolves — cannot be used to enumerate slugs (#291)",
      schema: refs.SubmitReportResult,
    },
  },
});

/* #997 — the in-app "Report a problem" intake. @Public so it works for a
   signed-out visitor; a signed-in user's context is attached server-side from
   their session, never the body. 10/min per IP. */
route({
  method: "post",
  path: "/public/feedback",
  tag,
  summary: "Submit an in-app problem report (10/min per IP; works signed-out)",
  public: true,
  body: refs.SubmitFeedbackInput,
  responses: {
    200: { description: "The created report id", schema: refs.SubmitFeedbackResult },
  },
});


/* #970 — the public pricing table, built from the public-visible plans' live
   feature matrix and limits. Unauthenticated, cached. */
route({
  method: "get",
  path: "/public/pricing",
  tag,
  summary: "The public pricing table (plans, feature matrix and limits)",
  public: true,
  responses: { 200: { description: "The pricing comparison table", schema: refs.PricingTable } },
});
