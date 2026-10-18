import { createHash } from "node:crypto";

/* ============================================================
   Branded error pages for the redirect's dead ends (#766).

   A visitor who follows an expired, used-up, not-yet-live or unknown short
   link used to get a bare text/plain sentence. Browsers now get a small,
   self-contained HTML page; everything else (curl, monitors, API clients —
   anything whose Accept does not ask for HTML) keeps the exact plain-text
   body it always got, so nothing that parses those responses breaks.

   Hot-path rules this follows (docs/DECISIONS.md, steering): no template
   engine, no file read per request, no new dependency, no external asset.
   The page is one string literal; the only dynamic values (the short link
   being visited, the activation date, the web origin) are HTML-escaped.
   Status codes are unchanged: 404 for unknown / not-yet-live / root, 410
   for expired / click-limited. A 302 to a web page was rejected in the
   issue because it would change what crawlers see.

   Both variants send `Cache-Control: no-store` and `Vary: Accept`. The CDN's
   cache key carries no headers, so without no-store the edge could hand a
   browser's HTML to the next curl (or the reverse) for its 1-5s TTL — and a
   dead end is not worth caching anyway: renewing a link should take effect
   on the very next click.
   ============================================================ */

export type ErrorKind = "not_found" | "expired" | "click_limit" | "scheduled" | "root";

interface Copy {
  status: 404 | 410;
  /** The plain-text body, byte-identical to what the redirect sent before #766. */
  text: string;
  title: string;
  body: string;
}

const COPY: Record<ErrorKind, Copy> = {
  not_found: {
    status: 404,
    text: "No such link.",
    title: "We couldn't find that link",
    body: "This short link doesn't exist. Check it for typos, or ask whoever shared it for a fresh one.",
  },
  expired: {
    status: 410,
    text: "This link has expired.",
    title: "This link has expired",
    body: "Its owner set it to stop working after a certain date. If you still need it, ask whoever shared it.",
  },
  click_limit: {
    status: 410,
    text: "This link has reached its click limit.",
    title: "This link has reached its click limit",
    body: "Its owner set it to work for a limited number of visits, and they've all been used.",
  },
  scheduled: {
    status: 404,
    text: "This link is not live yet.",
    title: "This link isn't live yet",
    body: "Its owner scheduled it to start working later. Check back then.",
  },
  root: {
    status: 404,
    text: "Nothing here.",
    title: "Nothing here",
    body: "This is a short-link domain. Add a link's code after the slash to follow it.",
  },
};

/** Escape for both HTML text and double-quoted attribute contexts. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Does this Accept header ask for HTML?
 *
 * True only when `text/html` (or `application/xhtml+xml`) is listed with a
 * non-zero q. A bare `*\/*` — curl's default, and most HTTP libraries' — is
 * deliberately NOT treated as HTML, so those clients keep the plain-text body.
 */
export function wantsHtml(accept: string | string[] | undefined): boolean {
  const raw = Array.isArray(accept) ? accept.join(",") : accept;
  if (!raw) return false;
  for (const range of raw.split(",")) {
    const [type, ...params] = range.split(";").map((part) => part.trim().toLowerCase());
    if (type !== "text/html" && type !== "application/xhtml+xml") continue;
    const q = params.find((p) => p.startsWith("q="));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    if (Number.isFinite(weight) && weight > 0) return true;
  }
  return false;
}

/* The stylesheet is static, so the CSP pins it by hash instead of allowing
   'unsafe-inline'. Light by default, dark via prefers-color-scheme; the
   colours are the web app's own --surface / --ink / --accent tokens (both
   schemes pass WCAG AA for body text and the button). */
const STYLE =
  ":root{color-scheme:light dark;--bg:#f7f9fb;--card:#fff;--line:#dfe5ec;--ink:#0c1219;--ink2:#4a5766;--acc:#1c55bd;--acc-ink:#fff}" +
  "@media (prefers-color-scheme:dark){:root{--bg:#10161e;--card:#151c25;--line:#242e3b;--ink:#e9eef4;--ink2:#a3b1c0;--acc:#73abff;--acc-ink:#06152b}}" +
  "*{box-sizing:border-box}" +
  "body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);" +
  "font:16px/1.55 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
  "main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px 28px}" +
  ".brand{margin:0 0 24px;font-weight:700;letter-spacing:-.01em}.brand span{color:var(--acc)}" +
  "h1{margin:0 0 8px;font-size:1.375rem;line-height:1.3}" +
  "p{margin:0 0 16px;color:var(--ink2)}" +
  "code{display:block;margin:0 0 20px;padding:8px 10px;border-radius:8px;background:var(--bg);color:var(--ink);" +
  "font:14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}" +
  "a{display:inline-block;padding:10px 16px;border-radius:10px;background:var(--acc);color:var(--acc-ink);font-weight:600;text-decoration:none}" +
  "a:focus-visible{outline:3px solid var(--ink);outline-offset:2px}";

const STYLE_HASH = createHash("sha256").update(STYLE).digest("base64");

/** Locks the page down to its own inline stylesheet: no script, no external
 *  fetch, no form, no framing, no <base> rewrite. */
export const ERROR_PAGE_CSP = [
  "default-src 'none'",
  `style-src 'sha256-${STYLE_HASH}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Long hosts/slugs are shown, not trusted: cap what is echoed back. */
const MAX_SHOWN = 200;

function shortLinkLabel(host: string, slug: string | undefined): string {
  const label = slug === undefined ? host : `${host}/${slug}`;
  return label.length > MAX_SHOWN ? `${label.slice(0, MAX_SHOWN)}…` : label;
}

export interface ErrorContext {
  /** The host the visitor asked (x-forwarded-host / Host). Untrusted. */
  host: string;
  /** The slug the visitor asked for. Untrusted. Omitted for the root page. */
  slug?: string;
  /** Scheduled links only: when the link goes live. */
  activatesAt?: Date | null;
  /** Where "Go to SnapURL" points. */
  webOrigin: string;
}

export interface ErrorResponse {
  status: 404 | 410;
  headers: Record<string, string>;
  body: string;
}

function renderHtml(copy: Copy, kind: ErrorKind, ctx: ErrorContext): string {
  const shown = ctx.host || ctx.slug ? shortLinkLabel(ctx.host, ctx.slug) : "";
  const when =
    kind === "scheduled" && ctx.activatesAt
      ? `<p>It goes live on <time datetime="${escapeHtml(ctx.activatesAt.toISOString())}">${escapeHtml(
          ctx.activatesAt.toUTCString(),
        )}</time>.</p>`
      : "";
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex">` +
    `<title>${escapeHtml(copy.title)} · SnapURL</title><style>${STYLE}</style></head>` +
    `<body><main><p class="brand">Snap<span>URL</span></p>` +
    `<h1>${escapeHtml(copy.title)}</h1><p>${escapeHtml(copy.body)}</p>${when}` +
    (shown ? `<code>${escapeHtml(shown)}</code>` : "") +
    `<a href="${escapeHtml(ctx.webOrigin)}">Go to SnapURL</a></main></body></html>`
  );
}

/** The slice of a Fastify request/reply sendError needs — kept structural so
 *  this module does not import Fastify and stays trivially testable. */
interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
}
interface ReplyLike<R> {
  code(status: number): R;
  header(name: string, value: string): R;
  send(body: string): R;
}

/** Write errorResponse() onto a reply. */
export function sendError<R extends ReplyLike<R>>(
  request: RequestLike,
  reply: R,
  kind: ErrorKind,
  ctx: ErrorContext,
): R {
  const res = errorResponse(kind, request.headers.accept, ctx);
  for (const [name, value] of Object.entries(res.headers)) reply.header(name, value);
  return reply.code(res.status).send(res.body);
}

/**
 * The response for a redirect dead end. Pure: the caller copies `status`,
 * `headers` and `body` onto the reply. `Retry-After` for scheduled links is
 * the caller's, as before, and applies to both variants.
 */
export function errorResponse(
  kind: ErrorKind,
  accept: string | string[] | undefined,
  ctx: ErrorContext,
): ErrorResponse {
  const copy = COPY[kind];
  const common = { "cache-control": "no-store", vary: "Accept", "x-content-type-options": "nosniff" };
  if (!wantsHtml(accept)) {
    return { status: copy.status, headers: { ...common, "content-type": "text/plain; charset=utf-8" }, body: copy.text };
  }
  return {
    status: copy.status,
    headers: {
      ...common,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": ERROR_PAGE_CSP,
      "referrer-policy": "no-referrer",
    },
    body: renderHtml(copy, kind, ctx),
  };
}
