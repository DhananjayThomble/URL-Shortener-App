/**
 * Shared Playwright `webServer.command` builder for the real-stack configs
 * (issue #883; reused by #884 a11y and #885 dom-xss).
 *
 * The real-stack configs serve the Next.js dashboard themselves through
 * Playwright's `webServer`. There are two ways to do that:
 *
 *  - `next build && next start` — self-contained, but pays the full
 *    production build on every run.
 *  - `next start` only — fast, but requires a prior `next build` to have left
 *    a `.next/` production bundle in place.
 *
 * In CI the stack is already built once (the real-stack job runs `next build`
 * as an explicit step before Playwright — see
 * `.kiro/specs/real-stack-ci/design.md` §2 "The prebuilt-server switch"), so a
 * second build inside `webServer` is wasted work (a11y) or the wrong runtime
 * (dom-xss's `next dev`). The `QA_PREBUILT_WEB` env switch lets a config skip
 * the build in that case while keeping the build in for a bare local run.
 *
 * `QA_PREBUILT_WEB=1` (truthy)  → `next start` only (a build already happened).
 * unset / empty / "0" / "false" → `build` is prepended, so a fresh local
 *                                 checkout still works with no extra step.
 *
 * The caller passes the env the web server needs (NEXT_PUBLIC_* etc.) both as
 * an inline prefix on the command AND via `webServer.env`; this helper only
 * composes the command string so every config spells "prebuilt" the same way.
 */

/** True when QA_PREBUILT_WEB names a build that already ran. */
export function isPrebuiltWeb(): boolean {
  const v = process.env.QA_PREBUILT_WEB;
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

export interface WebServerCommandOptions {
  /** Host port `next start` binds to (journeys 3000, webkit 3100, …). */
  port: number;
  /**
   * Env assignments prefixed inline on the command, in `KEY=value` form, e.g.
   * `["NEXT_PUBLIC_USE_FIXTURES=false", "NEXT_PUBLIC_API_URL=…"]`. Prefixed so
   * the values apply to `next build` as well as `next start` — a Next.js
   * production build bakes `NEXT_PUBLIC_*` in at build time, so the build and
   * the start must see identical values or the served bundle disagrees with
   * the running config. Pass the same set to `webServer.env` for `next start`.
   */
  env?: string[];
}

/**
 * Build the `webServer.command` string for a real-stack Playwright config.
 *
 * When `QA_PREBUILT_WEB` is truthy the command is `next start` only; otherwise
 * it is `next build && next start`, so a local run with no prior build still
 * serves a production bundle. The web project is always driven through the
 * workspace filter (`pnpm --filter snapurl-web exec next …`).
 */
export function webServerCommand(opts: WebServerCommandOptions): string {
  const prefix = opts.env && opts.env.length > 0 ? `${opts.env.join(" ")} ` : "";
  const start = `${prefix}pnpm --filter snapurl-web exec next start --port ${opts.port}`;
  if (isPrebuiltWeb()) return start;
  const build = `${prefix}pnpm --filter snapurl-web exec next build`;
  return `${build} && ${start}`;
}
