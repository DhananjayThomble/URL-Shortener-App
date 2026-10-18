/**
 * Where to go after signing in or registering, from a `?next=` parameter.
 *
 * Used by the /invite flow (#668): a signed-out invitee is sent to /login or
 * /register with `next=/invite?token=…`, and must land back on the invitation
 * afterwards with the token intact.
 *
 * Only same-origin, absolute paths are honoured. Anything else — a full URL,
 * a protocol-relative `//evil.example`, a backslash trick `/\evil.example`
 * (browsers normalise `\` to `/`), or a control character — falls back to the
 * default, so the parameter cannot be used as an open redirect.
 */
export function safeNext(raw: string | null | undefined, fallback = "/links"): string {
  if (!raw) return fallback;
  if (!isSafePath(raw)) return fallback;
  try {
    // Resolve against a throwaway origin: if it escapes it, it isn't a path.
    const url = new URL(raw, "https://snapurl.invalid");
    if (url.origin !== "https://snapurl.invalid") return fallback;
    const out = `${url.pathname}${url.search}${url.hash}`;
    /* #699 — normalising can MANUFACTURE the very prefix the raw check
       refused: "/..//evil.example", "/.//evil.example", "/%2e%2e//evil.example"
       and "/a/..//evil.example" all resolve to "//evil.example", which
       router.push treats as protocol-relative and leaves the site for. So the
       value actually returned is checked again, by the same rules. */
    return isSafePath(out) ? out : fallback;
  } catch {
    return fallback;
  }
}

/** A same-origin absolute path: one leading "/", no "//" or "/\" prefix, no
 *  backslash or control character anywhere, and (#775) no percent-ENCODED
 *  slash, backslash or control character in the path part. No SnapURL route
 *  has an encoded "/" or "\" in its path, and leaving them in hands a later
 *  decode (a proxy, a framework, a copy-paste) the chance to manufacture the
 *  "//host" the raw check refused. The query and fragment are data and may
 *  legitimately carry them (e.g. `/links?new=https%3A%2F%2F…`, #660). */
function isSafePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return false;
  if (/%(2f|5c|[01][0-9a-f]|7f)/i.test(pathPart(path))) return false;
  return true;
}

/** Everything before the first "?" or "#" (positional split, so an empty-but-
 *  present delimiter is handled). */
function pathPart(path: string): string {
  const hash = path.indexOf("#");
  const beforeHash = hash === -1 ? path : path.slice(0, hash);
  const query = beforeHash.indexOf("?");
  return query === -1 ? beforeHash : beforeHash.slice(0, query);
}

/** Auth pages a `next` must never point back at — it would bounce the visitor
 *  straight back to a sign-in form after signing in. */
const AUTH_PATHS = new Set(["/login", "/register"]);

/**
 * The /login URL the authenticated-area guard sends a signed-out visitor to
 * (#775): `/login?next=<the page they asked for, with its query and hash>`, so
 * signing in (including the 2FA step) lands back there instead of on /links.
 *
 * Takes the browser location rather than reading it, so it stays a pure
 * function. The location is attacker-influenceable (a crafted link to
 * `https://app//evil.example` has pathname `//evil.example`), so it goes
 * through the same safeNext rules as any other `next`; anything unsafe gives a
 * bare `/login`.
 */
export function loginRedirectFor(loc: { pathname: string; search?: string; hash?: string }): string {
  const target = safeNext(`${loc.pathname}${loc.search ?? ""}${loc.hash ?? ""}`, "");
  if (!target || AUTH_PATHS.has(pathPart(target))) return "/login";
  return withNext("/login", target);
}

/** `/login?next=…` / `/register?next=…`, or the bare route when there is no valid next. */
export function withNext(route: "/login" | "/register", next: string | null | undefined): string {
  const target = safeNext(next, "");
  return target ? `${route}?next=${encodeURIComponent(target)}` : route;
}
