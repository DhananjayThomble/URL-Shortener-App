/**
 * "Is someone signed in on this browser?" — as a cheap, synchronous HINT (#777).
 *
 * The session lives in localStorage (client.ts#tokens), so the static marketing
 * pages cannot know it at build time and must not pay an API call per page view
 * to find out. The stored tokens are the cheapest signal there is: reading them
 * costs nothing, and the answer is available before first paint.
 *
 * It is a hint, not proof: the tokens may be expired or revoked. That is fine
 * for the marketing header (a stale "Go to dashboard" lands on the dashboard
 * guard, which clears the dead tokens and sends the visitor to /login). Anything
 * that must be SURE — redirecting away from /login — verifies with GET /auth/me
 * first (useRedirectIfSignedIn).
 *
 * How it reaches the page without a flash or a hydration mismatch: a tiny inline
 * script in the root layout (PREPAINT_SESSION_HINT) sets `data-auth="in"` on
 * <html> before the first paint, and the header renders BOTH variants with CSS
 * (globals.css `.auth-in` / `.auth-out`) choosing between them. The server HTML
 * is identical for everyone, so the pages stay fully static.
 *
 * Kept free of imports (no zod, no contract) so the marketing bundle stays small.
 */

/** Mirrors the keys client.ts stores tokens under; client.ts imports them from here. */
export const ACCESS_TOKEN_KEY = "snapurl.accessToken";
export const REFRESH_TOKEN_KEY = "snapurl.refreshToken";

export const SESSION_HINT_ATTR = "data-auth";
const SESSION_HINT_VALUE = "in";

/** Reads one storage key; null when absent. */
type ReadKey = (key: string) => string | null;

/** True when a token is stored. Never throws: blocked storage means "not signed in". */
export function hasSessionHint(read: ReadKey | null): boolean {
  if (!read) return false;
  try {
    return Boolean(read(ACCESS_TOKEN_KEY)) || Boolean(read(REFRESH_TOKEN_KEY));
  } catch {
    return false;
  }
}

type AttrTarget = Pick<Element, "setAttribute" | "removeAttribute">;

/** Reflect the hint on <html> (or a stand-in). */
export function applySessionHint(root: AttrTarget, signedIn: boolean): void {
  if (signedIn) root.setAttribute(SESSION_HINT_ATTR, SESSION_HINT_VALUE);
  else root.removeAttribute(SESSION_HINT_ATTR);
}

/** localStorage.getItem as a ReadKey; null in private mode, embedded webviews, SSR. */
function browserRead(): ReadKey | null {
  try {
    if (typeof window === "undefined") return null;
    const s = window.localStorage;
    return (key) => s.getItem(key);
  } catch {
    return null;
  }
}

/** Is a token stored in THIS browser right now? */
export function hasStoredSession(): boolean {
  return hasSessionHint(browserRead());
}

/**
 * Re-read storage and update <html>. Called whenever the tokens change in this
 * tab (client.ts#tokens.set/clear) and when another tab changes them (the
 * header's `storage` listener), so a client-side navigation never shows a
 * stale header after sign-in or sign-out.
 */
export function syncSessionHint(): void {
  if (typeof document === "undefined") return;
  applySessionHint(document.documentElement, hasStoredSession());
}

/**
 * The inline script for the root layout's <head>. Runs before first paint; the
 * try/catch keeps blocked storage from breaking the page. Takes `localStorage`
 * and `document` from the surrounding scope (the tests pass fakes).
 */
export const PREPAINT_SESSION_HINT = `try{if(localStorage.getItem(${JSON.stringify(ACCESS_TOKEN_KEY)})||localStorage.getItem(${JSON.stringify(
  REFRESH_TOKEN_KEY,
)}))document.documentElement.setAttribute(${JSON.stringify(SESSION_HINT_ATTR)},${JSON.stringify(SESSION_HINT_VALUE)})}catch(e){}`;
