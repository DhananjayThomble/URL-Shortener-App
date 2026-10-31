/* Registry parity guard (spec: api-stack-tests, H3, design §3).
 *
 * The reflected route inventory must equal the OpenAPI registry's route set
 * exactly. A route on a controller but not registered (the frontend and the
 * generated OpenAPI doc never learn about it), or registered but not on any
 * controller (the doc describes a route that does not exist), fails here.
 *
 * This is a PLAIN `*.test.ts`: it needs no running stack, so it runs in the
 * normal `pnpm test` / verify job alongside the rest of the suite.
 *
 * ── Why everything is loaded by dynamic import ────────────────────────────────
 * `openapi/registry.ts` calls `extendZodWithOpenApi(z)` so every contract schema
 * is constructed with a working `.openapi()`. That patch is applied per zod
 * schema AT CONSTRUCTION, so a schema built before the patch runs never gets it.
 * esbuild/Vitest hoist every STATIC import to the top of the file, so a static
 * `import` of the inventory (which pulls in the controllers, which pull in
 * `@snapurl/contract` and construct all its schemas) would run that construction
 * before any code in this file. We therefore import NOTHING from the app or the
 * contract statically: `beforeAll` patches the ESM zod first, then dynamically
 * imports the registry, the path modules and the inventory — dynamic imports are
 * not hoisted, so the patch is in place before the first contract schema is
 * built. Proven on #889.
 */
import { beforeAll, describe, expect, it } from "vitest";

const PREFIX = "api/v1";

let inventoryKeys: string[];
let registeredKeys: string[];
let inventoryCount: number;

beforeAll(async () => {
  // Patch BOTH zod instances before the contract is imported anywhere. Under
  // Vitest this test file resolves the ESM zod while the compiled contract dist
  // that registry.ts pulls in resolves the CJS zod — two distinct instances,
  // each with its own schema-construction methods. zod-to-openapi's register()
  // reads `.openapi()` off whichever instance built the schema, so both must
  // carry the patch, and both must be patched before any contract schema is
  // constructed (hence the dynamic imports below, which esbuild does not hoist).
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);

  const { z: esmZod } = await import("zod");
  const { extendZodWithOpenApi } = await import("@asteasolutions/zod-to-openapi");
  extendZodWithOpenApi(esmZod);

  const cjsZodModule = require("zod");
  extendZodWithOpenApi(cjsZodModule.z ?? cjsZodModule);

  // Registry first (it registers every contract schema on load), then the path
  // modules for their side effect (each calls route(...)), exactly as
  // openapi/document.ts does. Then the inventory, which pulls in the controllers.
  const { registry } = await import("../openapi/registry.js");
  await Promise.all([
    import("../openapi/paths/analytics.js"),
    import("../openapi/paths/auth.js"),
    import("../openapi/paths/bio-pages.js"),
    import("../openapi/paths/developers.js"),
    import("../openapi/paths/domains.js"),
    import("../openapi/paths/forms.js"),
    import("../openapi/paths/health.js"),
    import("../openapi/paths/links.js"),
    import("../openapi/paths/members.js"),
    import("../openapi/paths/public.js"),
    import("../openapi/paths/reports.js"),
    import("../openapi/paths/workspaces.js"),
  ]);
  const { buildRouteInventory, routeKeys } = await import("./route-inventory.js");

  const inventory = buildRouteInventory(PREFIX);
  inventoryCount = inventory.length;
  inventoryKeys = routeKeys(inventory);
  registeredKeys = registry.definitions
    .filter((d): d is Extract<typeof d, { type: "route" }> => d.type === "route")
    .map((d) => `${d.route.method.toUpperCase()} /${PREFIX}${d.route.path}`)
    .sort();
});

describe("registry parity: the reflected inventory equals the OpenAPI registry", () => {
  it("every controller route is registered and every registered route exists on a controller", () => {
    const missingFromRegistry = inventoryKeys.filter((r) => !registeredKeys.includes(r));
    const missingFromControllers = registeredKeys.filter((r) => !inventoryKeys.includes(r));

    expect(
      { missingFromRegistry, missingFromControllers },
      "inventory and registry disagree — register the controller routes in openapi/paths/*.ts, " +
        "or remove the registered route that no controller serves",
    ).toEqual({ missingFromRegistry: [], missingFromControllers: [] });
  });

  it("the inventory has the 71 routes the design records (design Appendix A)", () => {
    expect(inventoryCount).toBe(71);
  });
});
