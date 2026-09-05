import { extendZodWithOpenApi, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z, type ZodTypeAny } from "zod";

/* Patches zod's schema-construction methods (.object(), .extend(), .optional(),
   etc.) so that whatever they build carries a working .openapi(). This is NOT
   a plain prototype patch that applies retroactively — it has to run before a
   single schema anywhere in the process is constructed, packages/contract
   included, or the schemas already built by then keep the unpatched methods.
   That is why this sits between the two imports rather than above both:
   `import * as Contract from "@snapurl/contract"` below is what constructs
   every schema in the contract package, so it has to come after this call,
   not before it — an ordinary top-of-file import block would run Contract's
   construction first and this patch second, silently too late. */
extendZodWithOpenApi(z);

import * as Contract from "@snapurl/contract";

/* ============================================================
   The OpenAPI registry, generated from packages/contract rather
   than from decorators.

   The API deliberately has no class-validator DTOs to hang
   @nestjs/swagger's usual @ApiProperty() introspection off of —
   see docs/DECISIONS.md's stack-choices table ("I dropped
   nestjs-zod mid-build"). Decorating every controller method by
   hand instead would just grow a second description of each shape
   that can drift from packages/contract the same way
   web/README.md's endpoint table already had (#339) — two sources
   of truth for the same schema, silently disagreeing.

   So every request/response body here is the SAME zod schema the
   API validates against and the frontend imports, fed through
   @asteasolutions/zod-to-openapi. Registering a schema is a plain
   object walk over every named export of @snapurl/contract that is
   actually a ZodType — the two exported `as const` string tuples
   (API_SCOPES, WEBHOOK_EVENTS) and the isDeniedHost() helper fail
   that check and are skipped without needing to name them.
   ============================================================ */

export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description:
    "A session access token (from /auth/login, /auth/oauth or /auth/register) or an API key prefixed snap_live_.",
});

/** Every contract export, registered under its own name so route definitions
 *  below can reference `refs.Link` etc. and get a `$ref` in the generated
 *  document instead of the schema inlined again at every use site — the
 *  library links a schema to its ref by the identity of what register()
 *  RETURNS, not the original import, which is why every route file imports
 *  from here rather than from @snapurl/contract directly. */
export const refs: Record<string, ZodTypeAny> = {};
for (const [name, value] of Object.entries(Contract)) {
  if (value instanceof z.ZodType) {
    refs[name] = registry.register(name, value);
  }
}

/** Two shapes with no equivalent in packages/contract: /health has no
 *  request/response contract (it's an infra probe, not part of the app's
 *  data contract), and path/query params are validated at the NestJS layer
 *  (ParseUUIDPipe, etc.) rather than by a named zod schema, so there is
 *  nothing in the contract package to point at for them either. */
export const IdParam = z.object({ id: z.string().describe("Resource id (UUID)") });
export const SlugParam = z.object({ slug: z.string().describe("The link, form or bio page's back-half") });
export const HealthStatus = registry.register(
  "HealthStatus",
  z.object({
    status: z.enum(["ok", "degraded"]),
    database: z.enum(["ok", "unreachable"]),
    latencyMs: z.number(),
  }),
);

type Method = "get" | "post" | "patch" | "put" | "delete";

interface ResponseDef {
  description: string;
  schema?: ZodTypeAny;
  contentType?: string;
}

interface RouteDef {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  /** Defaults to requiring the bearer scheme; set true for an @Public() route. */
  public?: boolean;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
  bodyContentType?: string;
  responses: Record<number, ResponseDef>;
}

/** One call per endpoint, matching the #339 inventory of every controller.
 *  Kept as a single helper (rather than repeating registerPath's shape at
 *  every call site) purely to fold the security/content-type boilerplate
 *  that is identical across ~60 routes into one place. */
export function route(def: RouteDef): void {
  registry.registerPath({
    method: def.method,
    path: def.path,
    tags: [def.tag],
    summary: def.summary,
    security: def.public ? [] : [{ bearerAuth: [] }],
    request: {
      // params/query are always registered as z.object({...}) at every call
      // site (IdParam, SlugParam, or an inline z.object(...)) — the cast is
      // only here because `refs` erases that to the base ZodType so every
      // export of @snapurl/contract fits in one map.
      ...(def.params ? { params: def.params as z.ZodObject } : {}),
      ...(def.query ? { query: def.query as z.ZodObject } : {}),
      ...(def.body
        ? { body: { content: { [def.bodyContentType ?? "application/json"]: { schema: def.body } } } }
        : {}),
    },
    responses: Object.fromEntries(
      Object.entries(def.responses).map(([status, r]) => [
        status,
        {
          description: r.description,
          ...(r.schema ? { content: { [r.contentType ?? "application/json"]: { schema: r.schema } } } : {}),
        },
      ]),
    ),
  });
}
