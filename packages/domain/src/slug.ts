import { randomInt } from "node:crypto";

/* Slug generation and the words a slug is not allowed to be. */

/** No look-alikes: 0/O, 1/l/I are all absent, so a slug read aloud or off
 *  a printed QR code cannot be transcribed into a different link. */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";

export function generateSlug(length = 7): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/**
 * Slugs that would collide with a route, mislead a visitor, or embarrass the
 * workspace that got assigned one at random.
 *
 * The `p` entry matters most: /p/:slug is the public preview route, so a link
 * with the slug "p" would shadow the trust page the product points people at.
 */
export const RESERVED_SLUGS = new Set([
  // routes the apps own
  "api", "p", "preview", "_next", "static", "assets", "favicon.ico", "robots.txt", "sitemap.xml",
  "health", "healthz", "metrics", "status",
  // dashboard routes, so a link never shadows the app
  "login", "register", "signup", "signin", "logout", "settings", "links", "analytics",
  "conversions", "domains", "team", "developers", "bio", "qr", "dashboard", "account",
  // things that read as official
  "admin", "root", "support", "help", "billing", "security", "abuse", "legal", "privacy",
  "terms", "www", "mail", "smtp", "ftp", "ns1", "ns2",
]);

const PROFANE = /^(fuck|shit|cunt|bitch|nigg|rape|slut|whore)/i;

export function isSlugAvailableShape(slug: string): { ok: boolean; reason?: string } {
  if (slug.length < 1) return { ok: false, reason: "Give the link a back-half." };
  if (slug.length > 64) return { ok: false, reason: "Back-halves are limited to 64 characters." };
  if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
    return { ok: false, reason: "Use letters, numbers, dots, dashes or underscores." };
  }
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    return { ok: false, reason: `"${slug}" is reserved by SnapURL. Try another back-half.` };
  }
  if (PROFANE.test(slug)) {
    return { ok: false, reason: "That back-half isn't available." };
  }
  // A slug that looks like a file would be fetched, not followed.
  if (/\.(html?|php|aspx?|jsp|json|xml|txt|js|css|map)$/i.test(slug)) {
    return { ok: false, reason: "Back-halves can't end in a file extension." };
  }
  return { ok: true };
}

/**
 * Random slugs are generated, not counted up.
 *
 * A sequential id would let anyone enumerate every link in the system by
 * incrementing a number — including private ones, expired ones, and the beta
 * invite links in the fixtures. 7 characters of this alphabet is ~10^12
 * combinations, so collisions are rare enough that a handful of retries at
 * insert time is the whole collision strategy.
 */
export const SLUG_RETRY_LIMIT = 8;
