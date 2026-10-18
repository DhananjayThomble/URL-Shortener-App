/**
 * A `next` longer than this is refused outright. No SnapURL route plus its
 * query comes anywhere near it; the cap only stops an absurd value becoming an
 * unwieldy URL (there is no redirect risk — an over-long value still resolves
 * on-origin). 2048 matches the de-facto URL length browsers and proxies treat
 * as safe.
 */
const MAX_NEXT_LENGTH = 2048;

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
  if (raw.length > MAX_NEXT_LENGTH) return fallback;
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
 *  slash, backslash or control character in the path part — at ANY depth of
 *  encoding. No SnapURL route has an encoded "/" or "\" in its path, and
 *  leaving one in hands a later decode (a proxy, a framework, a copy-paste)
 *  the chance to manufacture the "//host" the raw check refused. A single
 *  check on the literal string misses a DOUBLY-encoded value ("%252F" ->
 *  "%2F" -> "/"), so the path part is decoded to a fixed point first and the
 *  check runs on every intermediate form. The query and fragment are data and
 *  may legitimately carry encoded slashes (e.g. `/links?new=https%3A%2F%2F…`,
 *  #660), so only the path part is inspected. */
function isSafePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return false;
  return !hasEncodedPathTrap(pathPart(path));
}

/** True if the path part contains an encoded "/", "\", C0 control or DEL at any
 *  depth of percent-encoding (so "%252F" and deeper are caught, not just "%2F").
 *  Also rejects a stray "%25" that could seed a further decode downstream. */
function hasEncodedPathTrap(pathOnly: string): boolean {
  let current = pathOnly;
  // Each pass peels one layer of percent-encoding. A real path needs none; the
  // bound stops a pathological input from spinning, and reaching it is itself
  // reason to refuse.
  for (let depth = 0; depth < 8; depth++) {
    if (/%(2f|5c|[01][0-9a-f]|7f|25)/i.test(current)) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      // A malformed escape cannot be a route we own.
      return true;
    }
    if (decoded === current) return false; // fixed point: nothing left to decode
    if (decoded.includes("/") || decoded.includes("\\")) return true;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(decoded)) return true;
    current = decoded;
  }
  return true; // did not converge within the bound — refuse
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

/**
 * Where a visitor who is ALREADY signed in goes when they open /login or
 * /register (#777): the safe `?next=`, else the dashboard.
 *
 * Same rules as any other `next` (safeNext), plus one: it never points at an
 * auth page. Landing on /login again would re-run the "already signed in"
 * check there, so a crafted `/login?next=/login` could not become a loop only
 * by luck of the router; refusing it up front makes that structural.
 */
export function signedInTarget(raw: string | null | undefined): string {
  const target = safeNext(raw);
  const path = pathPart(target).replace(/\/+$/, "");
  return AUTH_PATHS.has(path) ? "/links" : target;
}

/** `/login?next=…` / `/register?next=…`, or the bare route when there is no valid next. */
export function withNext(route: "/login" | "/register", next: string | null | undefined): string {
  const target = safeNext(next, "");
  return target ? `${route}?next=${encodeURIComponent(target)}` : route;
}
