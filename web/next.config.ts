import type { NextConfig } from "next";

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

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
