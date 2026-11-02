/* The @snapurl/telemetry public surface: the Node error-tracking init, the pure
   scrubber, and the sampling / kill-switch seam. Web uses @sentry/nextjs
   directly (a different runtime and build integration) but shares the same
   scrub + sampling policy from here, so the rules live in one place. */

export { initNodeTelemetry } from "./node.js";
export type { NodeTelemetry, NodeTelemetryOptions, SentryApi } from "./node.js";

export { scrubEvent, stripQueryString, REDACTED } from "./scrub.js";
export type { ScrubbableEvent } from "./scrub.js";

export { SamplingController, parseSampleRate } from "./sampling.js";
export type { RuntimeControls, SamplingDefaults } from "./sampling.js";
