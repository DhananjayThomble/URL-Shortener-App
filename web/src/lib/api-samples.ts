/* The "Create a link" request shown on /developers.
 *
 * Kept out of the page component so a test can run the exact body through the
 * wire contract (CreateLinkInput). The page used to inline it, and it drifted:
 * the routing rule had no `id` (required by RoutingRule) and the expiry was a
 * hard-coded date that had already passed. Anything copied from the docs must
 * be accepted by POST /links once the key and domain are substituted.
 *
 * No expiresAt on purpose: a fixed date goes stale the day it passes, and a
 * relative one cannot be written into a static sample. */
export const CREATE_LINK_SAMPLE = {
  destination: "https://acme.com/spring",
  domain: "<your-domain>",
  slug: "spring-sale",
  tags: ["campaign/spring"],
  rules: [{ id: "rule_in", when: { country: "IN" }, then: "https://acme.in/spring" }],
} as const;

/* apiUrl is a parameter, not an import, so this module stays free of the
 * browser-only client and a test can load it. */
export const snippets = (apiUrl: string) =>
  ({
    curl: `curl -X POST ${apiUrl}/links \\
  -H "Authorization: Bearer $SNAP_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "destination": "https://acme.com/spring",
    "domain": "<your-domain>",
    "slug": "spring-sale",
    "tags": ["campaign/spring"],
    "rules": [
      { "id": "rule_in",
        "when": {"country": "IN"},
        "then": "https://acme.in/spring" }
    ]
  }'`,
  }) as const;
