import { z } from "zod";
import { refs, route } from "../registry.js";

route({
  method: "get",
  path: "/analytics",
  tag: "Analytics",
  summary: "Click analytics for the workspace, or one link",
  query: refs.AnalyticsQuery,
  responses: { 200: { description: "Analytics", schema: refs.Analytics } },
});

route({
  method: "get",
  path: "/conversions",
  tag: "Conversions",
  summary: "Recorded conversions for a range",
  // The controller reads `range` with a plain @Query, not zodQuery(AnalyticsQuery)
  // — no enum validation at the edge, unlike /analytics. Documented as a free
  // string here to match what the endpoint actually accepts today.
  query: z.object({ range: z.string().optional().describe('Defaults to "30d" in the handler; not validated') }),
  responses: { 200: { description: "Conversions report", schema: refs.ConversionsReport } },
});

route({
  method: "post",
  path: "/conversions",
  tag: "Conversions",
  summary: "Record a conversion (typically called with an API key)",
  body: refs.RecordConversionInput,
  responses: { 201: { description: "Recorded", schema: refs.RecordConversionResult } },
});
