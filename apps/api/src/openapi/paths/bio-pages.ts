import { z } from "zod";
import { IdParam, refs, route } from "../registry.js";

const tag = "Bio pages";

route({
  method: "get",
  path: "/bio-pages",
  tag,
  summary: "List bio pages",
  responses: { 200: { description: "Bio pages", schema: z.array(refs.BioPage) } },
});

route({
  method: "put",
  path: "/bio-pages",
  tag,
  summary: "Create or update the bio page for a (domain, slug)",
  body: refs.UpsertBioPageInput,
  responses: { 200: { description: "The bio page", schema: refs.BioPage } },
});

route({
  method: "delete",
  path: "/bio-pages/{id}",
  tag,
  summary: "Delete a bio page",
  params: IdParam,
  responses: { 204: { description: "Deleted" } },
});
