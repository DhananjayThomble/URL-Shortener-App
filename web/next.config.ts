import type { NextConfig } from "next";
import { createRequire } from "node:module";

/* This app is a pure client of the NestJS API. There are intentionally no
   route handlers under src/app/api — all data access goes through
   src/lib/api/client.ts to NEXT_PUBLIC_API_URL. */

/* A production build happens for two different reasons, and only one of them
 * needs configuration.
 *
 * CI compiles the app on every pull request purely to prove it compiles —
 * there is no API for it to point at and no user who will ever load the
 * result. A deploy is different: its output gets served to real browsers, and
 * shipping it unconfigured is the failure this guard exists to prevent.
 *
 * The default is strict, so an unrecognised environment is treated as a
 * deploy. The escape hatch is named for exactly what it permits, so nobody
 * sets it on a real deployment by accident. */
const isProductionBuild = process.env.NODE_ENV === "production";
const isCompileOnly = process.env.SNAPURL_ALLOW_UNCONFIGURED_BUILD === "true";

/* Fail the build rather than ship something quietly wrong.
 *
 * This file used to carry:
 *
 *   env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1" }
 *
 * which is worse than useless. Next.js already inlines NEXT_PUBLIC_* from the
 * environment, so the block added nothing except a localhost fallback — and a
 * Vercel build with the variable unset would bake `localhost:3001` into the
 * bundle. Every visitor's browser would then call its own machine, the app
 * would render empty, and nothing anywhere would say why.
 *
 * A deploy that is missing its configuration should not start. */
if (isProductionBuild && !isCompileOnly) {
  const problems: string[] = [];

  if (!process.env.NEXT_PUBLIC_API_URL) {
    problems.push(
      "NEXT_PUBLIC_API_URL is not set. Without it the app would call http://localhost:3001 from every visitor's browser.",
    );
  } else if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(process.env.NEXT_PUBLIC_API_URL)) {
    problems.push(
      `NEXT_PUBLIC_API_URL points at ${process.env.NEXT_PUBLIC_API_URL}, which is only reachable from the machine that built this.`,
    );
  }

  /* Fixtures are ~480 lines of invented data. Serving them in production means
     a site that looks completely functional and is entirely fake — the worst
     possible failure because nothing about it looks like a failure. */
  if (process.env.NEXT_PUBLIC_USE_FIXTURES === "true") {
    problems.push(
      "NEXT_PUBLIC_USE_FIXTURES is \"true\" in a production build. That serves invented demo data as if it were real.",
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `\n\nThis production build is not configured:\n\n${problems.map((p) => `  • ${p}`).join("\n")}\n\n` +
        `Set these in your hosting provider's environment settings. See web/.env.example.\n`,
    );
  }
}

/* #997 — the app version the "Report a problem" form attaches automatically.
 * Next inlines NEXT_PUBLIC_* at build time; default to the package version so a
 * local/dev build still reports something meaningful, and let a deploy override
 * it (e.g. with the commit sha) through the hosting environment. */
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.npm_package_version ?? "dev";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
};

/* #995 — Sentry source-map upload, CI ONLY and ONLY when a SENTRY_AUTH_TOKEN
 * secret exists; skip cleanly otherwise.
 *
 * withSentryConfig wraps the build to upload the browser source maps so stack
 * traces in Sentry are un-minified. That upload needs an auth token and the
 * org/project coordinates, and it is meant for the GitHub Actions CI build —
 * NOT the Vercel deploy (which has no SnapURL Sentry project configured and
 * whose own env may carry an unrelated token). So the gate is two conditions:
 * run on GitHub Actions (GITHUB_ACTIONS=true) AND with a token present. On
 * Vercel, a local build, a self-hoster's build, or any CI run without the
 * token, we return the plain config untouched and never load or call the Sentry
 * plugin at all — no upload, no failure, no network call. (The error-tracking
 * SDK itself is independent of this: it is gated on the DSN at runtime, not on
 * this build-time token.)
 *
 * withSentryConfig is require()'d INSIDE this branch, not imported at the top,
 * because the package's published type-export condition omits it from the entry
 * TS resolves and — more importantly — so Vercel never even loads the plugin. */
function withSourceMapUpload(config: NextConfig): NextConfig {
  const authToken = process.env.SENTRY_AUTH_TOKEN;
  const inGithubCi = process.env.GITHUB_ACTIONS === "true";
  if (!authToken || !inGithubCi) return config;

  // Resolve withSentryConfig from the package's config entry. It is NOT on the
  // runtime index export in this SDK version — it lives in the build-config
  // module — so we require that resolved path directly. Loaded only here, in
  // the GitHub-CI branch, so Vercel and local/self-host builds never touch it.
  const require = createRequire(import.meta.url);
  const sentryEntry = require.resolve("@sentry/nextjs");
  const configEntry = sentryEntry.replace(/index\.server\.js$/, "config/index.js");
  const { withSentryConfig } = require(configEntry) as {
    withSentryConfig: (config: NextConfig, options: Record<string, unknown>) => NextConfig;
  };
  return withSentryConfig(config, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken,
    // Upload source maps, then hide them from the public bundle so minified
    // output ships without exposing source. Quiet unless something fails.
    sourcemaps: { deleteSourcemapsAfterUpload: true },
    silent: false,
    // The release the maps attach to — match the runtime release tag.
    release: { name: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? appVersion },
    // Do not let a telemetry/upload problem fail a product build.
    telemetry: false,
  });
}

export default withSourceMapUpload(nextConfig);
