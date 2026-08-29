/* The single source of truth for the SnapURL wire format.
 *
 * Imported by web/ (browser) and by apps/api (server). When a payload changes,
 * change it here — tsc then points at every call site that needs updating,
 * which is the whole reason this package exists.
 */
export * from "./link.js";
export * from "./analytics.js";
export * from "./workspace.js";
export * from "./auth.js";
export * from "./public.js";
export * from "./form.js";
