/* Pure helper: decide whether the active tab's URL can be shortened.
 *
 * A shortener only makes sense for public http(s) pages. Browser-internal
 * pages (chrome://, about:), the extension's own pages (chrome-extension://,
 * moz-extension://) and local files (file://) are neither reachable by the
 * redirect service nor meaningful to share, so we reject them with a reason
 * the popup can show instead of a confusing API error.
 */

export type ShortenableResult = { ok: true; url: string } | { ok: false; reason: string };

export function shortenableUrl(tabUrl: string | undefined | null): ShortenableResult {
  if (!tabUrl || !tabUrl.trim()) {
    return { ok: false, reason: "There's no page to shorten." };
  }

  let parsed: URL;
  try {
    parsed = new URL(tabUrl);
  } catch {
    return { ok: false, reason: "This page's address can't be shortened." };
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return { ok: true, url: tabUrl };
  }

  return { ok: false, reason: "This is a browser or internal page and can't be shortened." };
}
