/*
 * Emit the API's route surface (OpenAPI paths) as a committed JSON artifact that
 * web's fixture-parity test consumes as DATA (issue #354). The route list crosses
 * the web<->apps boundary as serialized JSON, never as a source import, so the web
 * bundle still depends only on @snapurl/contract and @snapurl/domain.
 *
 * Runs on the COMPILED output (dist/), so it needs `pnpm --filter @snapurl/api build`
 * first and then plain node — no extra TS runner dependency. buildOpenApiDocument()
 * is static (no running server): it reads the registry populated by the path imports.
 *
 * Usage:  pnpm --filter @snapurl/api build && node apps/api/scripts/emit-openapi.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildOpenApiDocument } from "../dist/openapi/document.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../web/src/lib/api/openapi.generated.json");

const doc = buildOpenApiDocument("api");

const paths = {};
for (const [p, ops] of Object.entries(doc.paths ?? {})) {
  paths[p] = Object.keys(ops)
    .filter((k) => ["get", "post", "put", "patch", "delete"].includes(k.toLowerCase()))
    .map((m) => m.toUpperCase())
    .sort();
}

const sorted = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, JSON.stringify(sorted, null, 2) + "\n");
console.log(`Wrote ${Object.keys(sorted).length} paths to ${OUT}`);
