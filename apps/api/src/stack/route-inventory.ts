/* Route inventory by reflection (spec: api-stack-tests, design §3, H2).
 *
 * Walks every controller's prototype and reads the metadata NestJS stores from
 * its decorators — the technique in `session-hardening.integration.test.ts:51-62`
 * — to produce the API's real route surface. The parity guard
 * (`route-inventory.test.ts`) then asserts this equals the OpenAPI registry's
 * route set exactly, so a route added to a controller but not registered (or
 * vice versa) fails the build.
 *
 * Reading decorators is correct for an INVENTORY (what routes exist and what
 * they declare). It is NOT the authorization oracle — that is the
 * maintainer-approved access matrix (#891/#892). This file only describes the
 * surface; it never decides whether a given principal should reach a route.
 */
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { IS_PUBLIC, REQUIRED_ROLES, REQUIRED_SCOPE } from "../auth/auth.guard.js";

import { AnalyticsController } from "../analytics/analytics.controller.js";
import { AuthController } from "../auth/auth.controller.js";
import { BioPagesController } from "../bio-pages/bio-pages.controller.js";
import { HealthController } from "../common/health.controller.js";
import { ConversionsController } from "../conversions/conversions.controller.js";
import { DevelopersController } from "../developers/developers.controller.js";
import { DomainsController } from "../domains/domains.controller.js";
import { FormsController } from "../forms/forms.controller.js";
import { LinksController } from "../links/links.controller.js";
import { MembersController } from "../members/members.controller.js";
import { PublicController } from "../public/public.controller.js";
import { ReportsController } from "../reports/reports.controller.js";
import { WorkspacesController } from "../workspaces/workspaces.controller.js";

export interface RouteInfo {
  /** HTTP method, upper-case: GET | POST | PUT | PATCH | DELETE. */
  method: string;
  /** Full path including the API prefix, with `:id`-style params normalised to
   *  `{id}` so it compares directly with the OpenAPI registry. */
  path: string;
  /** `true` when the route carries `@Public()`. */
  public: boolean;
  /** Roles from `@Roles(...)`, or `[]` when none. */
  roles: string[];
  /** The scope from `@Scope(...)`, or `null` when none. */
  scope: string | null;
}

/** Every controller the app mounts. This list IS the inventory's claim about
 *  which controllers exist; a new controller that is not added here is invisible
 *  to the parity guard, which is why the guard also checks the registry→inventory
 *  direction (a registered route with no controller fails too). */
const CONTROLLERS = [
  AnalyticsController,
  AuthController,
  BioPagesController,
  ConversionsController,
  DevelopersController,
  DomainsController,
  FormsController,
  HealthController,
  LinksController,
  MembersController,
  PublicController,
  ReportsController,
  WorkspacesController,
] as const;

/** NestJS's `METHOD_METADATA` is a `RequestMethod` enum ordinal, not a verb, and
 *  its order (GET=0, POST=1, PUT=2, DELETE=3, PATCH=4, …) is not alphabetical —
 *  so resolve the verb from the enum itself rather than a hand-ordered array
 *  that silently swaps DELETE and PATCH. */
const METHOD_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(RequestMethod)
    .filter(([, v]) => typeof v === "number")
    .map(([name, ordinal]) => [ordinal as number, name]),
);

/** `:param` → `{param}`, and collapse any accidental double slashes, so the
 *  path matches the OpenAPI registry's `{id}` style and the `/<prefix>` join. */
function normalise(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\/{2,}/g, "/");
}

/** Join the prefix, the controller's base path and a method path into one
 *  leading-slash path, dropping empty segments (`@Controller()` has none). */
function joinPath(prefix: string, base: string, method: string): string {
  const parts = [prefix, base, method]
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p.length > 0);
  return "/" + parts.join("/");
}

function metadata<T>(fn: object, key: string): T | undefined {
  return Reflect.getMetadata(key, fn) as T | undefined;
}

/**
 * Reflect the full route surface, prefixed with `apiPrefix` (default the app's
 * `api/v1`). A method is a route when it carries `PATH_METADATA`; everything
 * else on the prototype (the constructor, helpers) is skipped.
 */
export function buildRouteInventory(apiPrefix = "api/v1"): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const controller of CONTROLLERS) {
    const base = (metadata<string>(controller, PATH_METADATA) ?? "") as string;
    const proto = controller.prototype as unknown as Record<string, unknown>;

    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      const fn = proto[name];
      if (typeof fn !== "function") continue;

      const methodPath = metadata<string>(fn as object, PATH_METADATA);
      if (methodPath === undefined) continue; // not a route handler

      const methodOrdinal = metadata<number>(fn as object, METHOD_METADATA) ?? RequestMethod.GET;
      const method = METHOD_NAME[methodOrdinal] ?? "GET";

      const isPublic = metadata<boolean>(fn as object, IS_PUBLIC) === true;
      const roles = (metadata<string[]>(fn as object, REQUIRED_ROLES) ?? []).slice().sort();
      const scope = metadata<string>(fn as object, REQUIRED_SCOPE) ?? null;

      routes.push({
        method,
        path: normalise(joinPath(apiPrefix, base, methodPath)),
        public: isPublic,
        roles,
        scope,
      });
    }
  }

  return routes.sort((a, b) => a.method.localeCompare(b.method) || a.path.localeCompare(b.path));
}

/** `METHOD PATH` keys for the inventory, the shape the parity guard compares. */
export function routeKeys(routes: RouteInfo[]): string[] {
  return routes.map((r) => `${r.method} ${r.path}`).sort();
}
