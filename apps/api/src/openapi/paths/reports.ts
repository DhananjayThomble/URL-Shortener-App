import { z } from "zod";
import { IdParam, refs, route } from "../registry.js";

const tag = "Abuse reports";

route({
  method: "get",
  path: "/reports",
  tag,
  summary: "List abuse reports (operator-side review queue)",
  responses: { 200: { description: "Reports", schema: z.array(refs.AbuseReport) } },
});

route({
  method: "patch",
  path: "/reports/{id}",
  tag,
  summary: "Review an abuse report",
  params: IdParam,
  body: refs.UpdateAbuseReportInput,
  responses: { 200: { description: "The updated report", schema: refs.AbuseReport } },
});
