/*
 * Chrome Web Store packaging for the SnapURL extension.
 *
 * Produces a store-ready zip of the built extension: it runs the esbuild build
 * (so dist/ is fresh), then zips the CONTENTS of dist/ (not the dist/ folder
 * itself — the Web Store expects manifest.json at the archive root) into
 * apps/extension/snapurl-extension-<version>.zip. The version is read from
 * public/manifest.json so the artifact name always matches what ships.
 *
 * Zipping is done with Node's built-in stream + the platform `zip` when present,
 * falling back to a pure-JS deflate so packaging works on a machine without the
 * zip binary. No remote code, no network — this is a local build step (SPEC F14).
 *
 * Usage:  pnpm --filter @snapurl/extension package
 */

import { execFileSync } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const distDir = resolve(root, "dist");
const manifestPath = resolve(root, "public", "manifest.json");

async function readVersion() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest.version) throw new Error("manifest.json has no version");
  return manifest.version;
}

function runBuild() {
  // Reuse the canonical build so dist/ matches exactly what tests/type-check saw.
  execFileSync("node", [resolve(root, "build.mjs")], { stdio: "inherit" });
}

async function ensureDist() {
  const s = await stat(distDir).catch(() => null);
  if (!s || !s.isDirectory()) throw new Error("dist/ missing after build");
  const manifestInDist = await stat(resolve(distDir, "manifest.json")).catch(() => null);
  if (!manifestInDist) throw new Error("dist/manifest.json missing — build did not copy public/");
}

/** Zip the CONTENTS of dist/ into outPath. Prefers the system zip; else JS fallback. */
async function zipDist(outPath) {
  await rm(outPath, { force: true });
  try {
    // -r recurse, -X strip extra attrs; run inside dist/ so paths are root-relative.
    execFileSync("zip", ["-r", "-X", outPath, "."], { cwd: distDir, stdio: "inherit" });
    return "zip";
  } catch {
    await zipDistJs(outPath);
    return "js-fallback";
  }
}

/* Minimal store (no compression) zip writer — enough for a valid .zip when the
 * `zip` binary is absent. Kept dependency-free (MV3/local-build hygiene). */
async function zipDistJs(outPath) {
  const { readdir } = await import("node:fs/promises");
  const { deflateRawSync, crc32 } = await import("node:zlib");
  const entries = [];
  async function walk(dir, prefix) {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      const abs = resolve(dir, name.name);
      const rel = prefix ? `${prefix}/${name.name}` : name.name;
      if (name.isDirectory()) await walk(abs, rel);
      else entries.push({ rel, data: await readFile(abs) });
    }
  }
  await walk(distDir, "");

  const out = createWriteStream(outPath);
  const chunks = [];
  let offset = 0;
  const central = [];
  const hasCrc32 = typeof crc32 === "function";
  for (const e of entries) {
    const nameBuf = Buffer.from(e.rel, "utf8");
    const comp = deflateRawSync(e.data);
    const crc = hasCrc32 ? crc32(e.data) >>> 0 : cheapCrc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localHeaderOffset = offset;
    for (const b of [local, nameBuf, comp]) {
      chunks.push(b);
      offset += b.length;
    }
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(localHeaderOffset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    chunks.push(c);
    cdSize += c.length;
    offset += c.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdStart, 16);
  chunks.push(end);

  await new Promise((res, rej) => {
    out.on("error", rej);
    out.on("finish", res);
    out.end(Buffer.concat(chunks));
  });
}

function cheapCrc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

async function main() {
  const version = await readVersion();
  runBuild();
  await ensureDist();
  const outPath = resolve(root, `snapurl-extension-${version}.zip`);
  const via = await zipDist(outPath);
  const { size } = await stat(outPath);
  console.log(`Packaged snapurl-extension-${version}.zip (${(size / 1024).toFixed(1)} KiB) via ${via}`);
  console.log(`Upload ${outPath} in the Chrome Web Store developer dashboard.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
