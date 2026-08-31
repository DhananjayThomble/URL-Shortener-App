import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/*
 * Manifest shape guard.
 *
 * The extension ships raw JSON to the browser, so a bad manifest is a runtime
 * failure Chrome shows only when you load the unpacked build. This test parses
 * the checked-in public/manifest.json and asserts the Manifest V3 least-privilege
 * shape the review checklist and the Chrome Web Store both require, catching drift
 * (an added <all_urls>, a loosened CSP, a dropped popup) at `pnpm test` time.
 */

// import.meta.url can be an http(s) URL under the happy-dom environment, so
// anchor the read on the package root vitest runs from instead of the module URL.
function readManifest(): Record<string, unknown> {
  const metaUrl = import.meta.url;
  const base = metaUrl.startsWith("file:")
    ? join(dirname(fileURLToPath(metaUrl)), "..", "public", "manifest.json")
    : join(process.cwd(), "public", "manifest.json");
  return JSON.parse(readFileSync(base, "utf8")) as Record<string, unknown>;
}

const manifest = readManifest();

describe("public/manifest.json", () => {
  it("is Manifest V3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("declares name, description and version", () => {
    expect(typeof manifest.name).toBe("string");
    expect((manifest.name as string).length).toBeGreaterThan(0);
    expect(typeof manifest.description).toBe("string");
    expect((manifest.description as string).length).toBeGreaterThan(0);
    expect(typeof manifest.version).toBe("string");
    expect((manifest.version as string).length).toBeGreaterThan(0);
  });

  it("registers a module service worker for the background", () => {
    const background = manifest.background as Record<string, unknown> | undefined;
    expect(background).toBeDefined();
    expect(background?.service_worker).toBe("background.js");
    expect(background?.type).toBe("module");
  });

  it("requests only least-privilege permissions (subset of activeTab + storage)", () => {
    const permissions = (manifest.permissions ?? []) as string[];
    expect(Array.isArray(permissions)).toBe(true);
    const allowed = new Set(["activeTab", "storage"]);
    for (const permission of permissions) {
      expect(allowed.has(permission)).toBe(true);
    }
  });

  it("does not request the <all_urls> host permission", () => {
    const hostPermissions = (manifest.host_permissions ?? []) as string[];
    expect(Array.isArray(hostPermissions)).toBe(true);
    expect(hostPermissions).not.toContain("<all_urls>");
    // The API base URL is user-configured and reached via fetch relying on the
    // API's opt-in CORS (FEAT-002); no broad host access is needed.
    expect(hostPermissions.length).toBe(0);
  });

  it("has a content security policy that forbids remote and inline code", () => {
    const csp = manifest.content_security_policy as Record<string, unknown> | undefined;
    expect(csp).toBeDefined();
    const extensionPages = csp?.extension_pages as string | undefined;
    expect(typeof extensionPages).toBe("string");
    expect(extensionPages).toContain("script-src 'self'");
    expect(extensionPages).not.toContain("unsafe-eval");
    expect(extensionPages).not.toContain("unsafe-inline");
    expect(extensionPages).not.toContain("http://");
    expect(extensionPages).not.toContain("https://");
  });

  it("declares a default popup action", () => {
    const action = manifest.action as Record<string, unknown> | undefined;
    expect(action).toBeDefined();
    expect(action?.default_popup).toBe("popup.html");
  });

  it("declares an options page", () => {
    const optionsUi = manifest.options_ui as Record<string, unknown> | undefined;
    const optionsPage = manifest.options_page as string | undefined;
    const hasOptions = optionsPage === "options.html" || optionsUi?.page === "options.html";
    expect(hasOptions).toBe(true);
  });

  it("declares icons for every required size", () => {
    const icons = manifest.icons as Record<string, string> | undefined;
    expect(icons).toBeDefined();
    for (const size of ["16", "32", "48", "128"]) {
      expect(typeof icons?.[size]).toBe("string");
      expect((icons?.[size] as string).length).toBeGreaterThan(0);
    }
  });
});
