import { z } from "zod";
import { IdParam, refs, route } from "../registry.js";

const tag = "Links";

route({
  method: "get",
  path: "/links",
  tag,
  summary: "List links in the workspace",
  query: refs.ListLinksQuery,
  responses: { 200: { description: "A page of matching links", schema: refs.LinkList } },
});

// Declared before /links/:id in the actual controller so "export" is never
// swallowed as an :id — this doc mirrors that path ordering for the same
// reason, though the generated spec itself has no ordering hazard.
route({
  method: "get",
  path: "/links/export",
  tag,
  summary: "Export matching links as CSV",
  query: refs.ListLinksQuery,
  responses: { 200: { description: "CSV file, streamed", schema: z.string(), contentType: "text/csv" } },
});

route({
  method: "get",
  path: "/links/{id}",
  tag,
  summary: "Get a single link",
  params: IdParam,
  responses: { 200: { description: "The link", schema: refs.Link } },
});

route({
  method: "post",
  path: "/links",
  tag,
  summary: "Create a link",
  body: refs.CreateLinkInput,
  responses: { 201: { description: "The created link", schema: refs.Link } },
});

route({
  method: "post",
  path: "/links/bulk",
  tag,
  summary: "Create up to 100 links in one call",
  body: refs.BulkCreateLinksInput,
  responses: {
    200: {
      description: "Always 200 — per-row success/failure is reported in the body, not the status",
      schema: refs.BulkCreateLinksResult,
    },
  },
});

route({
  method: "post",
  path: "/links/{id}/clone",
  tag,
  summary: "Clone a link",
  params: IdParam,
  body: refs.CloneLinkInput,
  responses: { 201: { description: "The cloned link", schema: refs.Link } },
});

route({
  method: "patch",
  path: "/links/{id}",
  tag,
  summary: "Update a link (not its domain or slug)",
  params: IdParam,
  body: refs.UpdateLinkInput,
  responses: { 200: { description: "The updated link", schema: refs.Link } },
});

route({
  method: "delete",
  path: "/links/{id}",
  tag,
  summary: "Delete a link",
  params: IdParam,
  responses: { 204: { description: "Deleted" } },
});
