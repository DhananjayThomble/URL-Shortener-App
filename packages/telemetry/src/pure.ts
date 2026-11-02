/* The runtime-agnostic subset of @snapurl/telemetry: the pure scrubber and the
   sampling helpers, with NO @sentry/node import. The web (a browser bundle)
   imports from here via "@snapurl/telemetry/pure" so pulling in the shared
   scrub/sampling policy does not drag Node-only @sentry/node (worker_threads,
   fs) into the client bundle. The Node services use the package root, which
   additionally exports the @sentry/node init. */

export { scrubEvent, stripQueryString, REDACTED } from "./scrub.js";
export type { ScrubbableEvent } from "./scrub.js";

export { SamplingController, parseSampleRate } from "./sampling.js";
export type { RuntimeControls, SamplingDefaults } from "./sampling.js";
