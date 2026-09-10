/* i18n wrapper over chrome.i18n.getMessage (F11).
 *
 * All user-facing strings go through t(key, subs?) so they can be localized
 * later without touching call sites. In the extension runtime this delegates to
 * chrome.i18n.getMessage, reading _locales/<locale>/messages.json. Under vitest
 * there is no chrome.i18n, so a test-friendly fallback map (registered via
 * setFallbackMessages) is consulted, and failing that the key itself is returned
 * — a test asserting on t("popup_shorten") never has to stub chrome.
 *
 * This file is created once by Track B and thereafter read-only (SPEC §5.4);
 * both tracks add keys to _locales/en/messages.json (append-only, alphabetized).
 */

type Substitutions = string | string[] | undefined;

let fallback: Record<string, string> = {};

/** Register fallback messages for non-browser contexts (tests). */
export function setFallbackMessages(messages: Record<string, string>): void {
  fallback = { ...messages };
}

function applySubs(template: string, subs: Substitutions): string {
  if (subs === undefined) return template;
  const list = Array.isArray(subs) ? subs : [subs];
  // chrome.i18n uses $1, $2, … placeholders in the raw "message" string.
  return template.replace(/\$(\d+)/g, (_, n: string) => list[Number(n) - 1] ?? "");
}

/**
 * Look up a localized message by key, substituting $1..$n placeholders. Falls
 * back to a registered map and finally to the key itself, so a missing string
 * degrades to something visible rather than empty.
 */
export function t(key: string, subs?: Substitutions): string {
  const i18n = globalThis.chrome?.i18n;
  if (i18n && typeof i18n.getMessage === "function") {
    const list = subs === undefined ? undefined : Array.isArray(subs) ? subs : [subs];
    const message = i18n.getMessage(key, list);
    if (message) return message;
  }
  if (key in fallback) return applySubs(fallback[key]!, subs);
  return key;
}
