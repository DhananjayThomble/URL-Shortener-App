import { z } from "zod";
import { refs, route, SlugParam } from "../registry.js";

const tag = "Public";

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
