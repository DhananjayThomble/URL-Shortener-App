import type { DeviceType } from "@snapurl/contract";

/* ============================================================
   Deep linking that is allowed to fail.

   The naive implementation — redirect to `spotify://track/123`
   — is the one that ruins the feature, and it ruins it silently.
   A custom scheme with no handler does not fall back: on iOS
   Safari it raises "Cannot Open Page", on desktop it does
   nothing at all, and in both cases the visitor is stranded on a
   link that worked yesterday for someone with the app.

   So the rule here is that a deep link may only be attempted
   where the platform provides a fallback *it* controls, and the
   destination is otherwise handed over untouched.

   Android provides exactly that. `intent://` URLs carry
   `S.browser_fallback_url`, which Chrome navigates to when no
   installed app claims the intent. App installed: the app opens.
   App absent: the browser goes to the web page. Neither outcome
   needs a timeout, a bounce page, or a guess.

   iOS provides it too, by a different route: every app listed
   below publishes an apple-app-site-association file, so its
   ordinary https URL *is* a Universal Link and opens the app
   when it is installed. Sending the plain URL is therefore not
   a gap on iOS — it is the mechanism. Attempting a custom
   scheme instead would trade a silent success for a visible
   error.

   Desktop gets the plain URL, because there is no app.
   ============================================================ */

/**
 * Hostname → Android package.
 *
 * Only the package is needed, deliberately. The intent below is built with
 * `scheme=https` and the destination's own path, so Android matches it against
 * the same intent filter the app already declares for its web URLs. That
 * avoids inventing per-app URI paths — `spotify://track/…`, `twitter://status?id=…`
 * and friends — which are undocumented, differ between app versions, and are
 * the part of a mapping table most likely to be quietly wrong.
 *
 * Suffix match on the registrable domain, so `www.`, `m.` and `open.`
 * subdomains all resolve without an entry each.
 */
const ANDROID_PACKAGES: ReadonlyArray<readonly [host: string, androidPackage: string]> = [
  ["youtube.com", "com.google.android.youtube"],
  ["youtu.be", "com.google.android.youtube"],
  ["spotify.com", "com.spotify.music"],
  ["instagram.com", "com.instagram.android"],
  ["twitter.com", "com.twitter.android"],
  ["x.com", "com.twitter.android"],
  ["tiktok.com", "com.zhiliaoapp.musically"],
  ["whatsapp.com", "com.whatsapp"],
  ["wa.me", "com.whatsapp"],
  ["facebook.com", "com.facebook.katana"],
  ["fb.com", "com.facebook.katana"],
  ["soundcloud.com", "com.soundcloud.android"],
  ["etsy.com", "com.etsy.android"],
  ["amazon.com", "com.amazon.mShop.android.shopping"],
  ["amazon.in", "com.amazon.mShop.android.shopping"],
  ["amazon.co.uk", "com.amazon.mShop.android.shopping"],
];

/** The apps a link can be deep-linked into, for the dashboard to be honest about. */
export const DEEP_LINK_HOSTS: readonly string[] = ANDROID_PACKAGES.map(([host]) => host);

function packageFor(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  for (const [suffix, pkg] of ANDROID_PACKAGES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return pkg;
  }
  return null;
}

/**
 * Turn a destination into whatever opens the app on this device, or leave it
 * alone.
 *
 * Returns the destination unchanged for every case that cannot do better:
 * deep linking off, a host with no known app, a device without one, or a URL
 * that will not parse. The caller can always redirect to what comes back.
 */
export function buildDeepLink(destination: string, device: DeviceType | null, enabled: boolean): string {
  if (!enabled) return destination;

  /* Only Android is rewritten. iOS is served by Universal Links on the plain
     https URL, and desktop has no app to open — see the note at the top. */
  if (device !== "android") return destination;

  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return destination;
  }
  // An intent built from a non-web scheme would be nonsense.
  if (url.protocol !== "https:" && url.protocol !== "http:") return destination;

  const androidPackage = packageFor(url.hostname);
  if (!androidPackage) return destination;

  /* Everything after the scheme becomes the intent's data, and the original
     URL becomes the fallback. Chrome uses one or the other; there is no path
     where the visitor gets neither. */
  const ssp = `${url.host}${url.pathname}${url.search}`;
  return (
    `intent://${ssp}#Intent;scheme=https;package=${androidPackage};` +
    `S.browser_fallback_url=${encodeURIComponent(destination)};end`
  );
}
