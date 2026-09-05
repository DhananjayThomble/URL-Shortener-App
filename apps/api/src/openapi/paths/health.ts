import { HealthStatus, route } from "../registry.js";

route({
  method: "get",
  path: "/health",
  tag: "Health",
  summary: "Liveness/readiness probe for a load balancer",
  public: true,
  responses: { 200: { description: "Health status", schema: HealthStatus } },
});
