import { z } from "zod";
import { IdParam, refs, route } from "../registry.js";

const tag = "Forms";

route({
  method: "get",
  path: "/forms",
  tag,
  summary: "List forms",
  responses: { 200: { description: "Forms", schema: z.array(refs.Form) } },
});

route({
  method: "get",
  path: "/forms/{id}",
  tag,
  summary: "Get a form",
  params: IdParam,
  responses: { 200: { description: "The form", schema: refs.Form } },
});

route({
  method: "get",
  path: "/forms/{id}/responses",
  tag,
  summary: "List a form's responses",
  params: IdParam,
  responses: { 200: { description: "Responses", schema: refs.FormResponseList } },
});

route({
  method: "get",
  path: "/forms/{id}/responses.csv",
  tag,
  summary: "Export a form's responses as CSV",
  params: IdParam,
  responses: { 200: { description: "CSV file, streamed", schema: z.string(), contentType: "text/csv" } },
});

route({
  method: "post",
  path: "/forms",
  tag,
  summary: "Create a form",
  body: refs.CreateFormInput,
  responses: { 201: { description: "The created form", schema: refs.Form } },
});

route({
  method: "patch",
  path: "/forms/{id}",
  tag,
  summary: "Update a form",
  params: IdParam,
  body: refs.UpdateFormInput,
  responses: { 200: { description: "The updated form", schema: refs.Form } },
});

route({
  method: "delete",
  path: "/forms/{id}",
  tag,
  summary: "Delete a form",
  params: IdParam,
  responses: { 204: { description: "Deleted" } },
});
