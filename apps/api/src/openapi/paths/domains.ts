import { z } from "zod";
import { IdParam, refs, route } from "../registry.js";

const tag = "Domains";

route({
  method: "get",
  path: "/domains",
  tag,
  summary: "List domains",
  responses: { 200: { description: "Domains", schema: z.array(refs.Domain) } },
});

route({
  method: "post",
  path: "/domains",
  tag,
  summary: "Add a domain",
  body: refs.AddDomainInput,
  responses: { 201: { description: "The added domain", schema: refs.Domain } },
});

route({
  method: "post",
  path: "/domains/{id}/verify",
  tag,
  summary: "Re-check a domain's DNS/TLS verification",
  params: IdParam,
  responses: { 200: { description: "The updated domain", schema: refs.Domain } },
});

route({
  method: "delete",
  path: "/domains/{id}",
  tag,
  summary: "Remove a domain",
  params: IdParam,
  responses: { 204: { description: "Deleted" } },
});
