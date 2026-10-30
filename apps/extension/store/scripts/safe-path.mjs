import { resolve, sep } from "node:path";

/**
 * Resolve a request path under `root`, or return null when it would escape it
 * (`..` segments, encoded traversal, NUL bytes, malformed percent-encoding).
 */
export function resolveWithin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = resolve(root);
  const target = resolve(base, "." + (decoded.startsWith("/") ? decoded : "/" + decoded));
  return target === base || target.startsWith(base + sep) ? target : null;
}
