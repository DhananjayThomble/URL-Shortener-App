import { refs, route } from "../registry.js";

/* #968 — platform-admin routes. Only GET /admin/me for now; later parts of the
   epic (#975) register their routes here as they land. */
route({
  method: "get",
  path: "/admin/me",
  tag: "Admin",
  summary: "The current platform admin",
  responses: {
    200: { description: "The confirmed platform admin", schema: refs.AdminMe },
    403: { description: "The caller is not a platform admin" },
  },
});
