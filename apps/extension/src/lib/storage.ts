/* The extension's small configuration layer over chrome.storage.local.
 *
 * The extension is self-hosting friendly: it does not hard-code a SnapURL
 * host. The user points it at their own API base URL and pastes a scoped API
 * key (snap_live_…), both of which live only in the browser's extension
 * storage. The API key is a secret, so this module is careful never to log it.
 */

const STORAGE_KEY = "snapurl:settings";

export interface Settings {
  /** Absolute http(s) origin of the SnapURL API, no trailing slash, no /api/v1. */
  apiBaseUrl: string;
  /** Scoped API key (snap_live_…). Secret; never logged. */
  apiKey: string;
  /** Optional default short domain used when creating a link without one. */
  defaultDomain?: string;
}

const EMPTY_SETTINGS: Settings = { apiBaseUrl: "", apiKey: "" };

/**
 * Normalize a user-entered API base URL: require an absolute http(s) URL and
 * strip any trailing slash so callers can safely append `/api/v1/links`.
 * Throws on anything that is not http(s) so a bad value is caught at save time
 * rather than producing a broken request later.
 */
export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Enter an API base URL.");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid absolute http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The API base URL must start with http:// or https://.");
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

/** True only when a non-blank API key is present. */
export function hasCredentials(settings: Settings): boolean {
  return settings.apiKey.trim().length > 0;
}

function storageLocal(): chrome.storage.StorageArea {
  const area = globalThis.chrome?.storage?.local;
  if (!area) throw new Error("chrome.storage.local is unavailable in this context.");
  return area;
}

/** Persist settings, normalizing the base URL. Never logs the key. */
export async function saveSettings(input: Settings): Promise<Settings> {
  const settings: Settings = {
    apiBaseUrl: input.apiBaseUrl ? normalizeApiBaseUrl(input.apiBaseUrl) : "",
    apiKey: input.apiKey.trim(),
    ...(input.defaultDomain ? { defaultDomain: input.defaultDomain.trim() } : {}),
  };
  await storageLocal().set({ [STORAGE_KEY]: settings });
  return settings;
}

/** Load settings, falling back to empty (unconfigured) values. */
export async function loadSettings(): Promise<Settings> {
  const result = await storageLocal().get(STORAGE_KEY);
  const stored = (result as Record<string, unknown>)[STORAGE_KEY];
  if (!stored || typeof stored !== "object") return { ...EMPTY_SETTINGS };
  const s = stored as Partial<Settings>;
  return {
    apiBaseUrl: typeof s.apiBaseUrl === "string" ? s.apiBaseUrl : "",
    apiKey: typeof s.apiKey === "string" ? s.apiKey : "",
    ...(typeof s.defaultDomain === "string" && s.defaultDomain ? { defaultDomain: s.defaultDomain } : {}),
  };
}
