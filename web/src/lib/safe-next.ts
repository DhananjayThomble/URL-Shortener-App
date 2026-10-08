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
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  try {
    // Resolve against a throwaway origin: if it escapes it, it isn't a path.
    const url = new URL(raw, "https://snapurl.invalid");
    if (url.origin !== "https://snapurl.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** `/login?next=…` / `/register?next=…`, or the bare route when there is no valid next. */
export function withNext(route: "/login" | "/register", next: string | null | undefined): string {
  const target = safeNext(next, "");
  return target ? `${route}?next=${encodeURIComponent(target)}` : route;
}
