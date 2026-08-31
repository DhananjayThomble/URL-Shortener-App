/*
 * esbuild bundler for the SnapURL Chrome extension.
 *
 * Manifest V3 forbids remote code, so every entry point is bundled into a
 * single self-contained ESM file (no runtime imports, no CDN). The static
 * assets in public/ — the manifest, the HTML pages, the stylesheet and the
 * icons — are copied verbatim into dist/, which is what you load unpacked in
 * chrome://extensions. dist/ is a build artifact and is gitignored.
 */

import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(here, "dist");
const publicDir = resolve(here, "public");

async function run() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  await build({
    entryPoints: {
      background: resolve(here, "src/background.ts"),
      popup: resolve(here, "src/popup.ts"),
      options: resolve(here, "src/options.ts"),
    },
    outdir,
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    // No remote code, no eval: MV3 requires the shipped bundle to be static.
    minify: false,
    sourcemap: false,
    logLevel: "info",
  });

  // Copy the static assets (manifest.json, *.html, styles.css, icons/) into dist/.
  await cp(publicDir, outdir, { recursive: true });

  console.log(`Built extension into ${outdir}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
