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
 *  backslash or control character anywhere. */
function isSafePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return false;
  return true;
}

/** `/login?next=…` / `/register?next=…`, or the bare route when there is no valid next. */
export function withNext(route: "/login" | "/register", next: string | null | undefined): string {
  const target = safeNext(next, "");
  return target ? `${route}?next=${encodeURIComponent(target)}` : route;
}
