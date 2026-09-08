# SnapURL — Security invariants & product context (steering)

## Security invariants — do not regress these
- Passwords: **argon2id** only. Never introduce a weaker hash or store a
  plaintext/reversible secret.
- Auth: 15-min access JWT + rotating refresh token with reuse detection and
  server-side logout. Do not lengthen access-token TTL or remove reuse
  detection without an ADR.
- OAuth ID tokens are **nonce-bound** — keep the nonce check.
- URL input passes the contract-layer SSRF guard (rejects dangerous schemes and
  internal hosts). Any new URL-accepting endpoint reuses that guard; never
  bypass it.
- Secrets come from SSM / Secrets Manager, never the repo. Do not commit a
  `.env` with real values, a key, or a token. Flag any file that looks like it
  carries one.
- The redirect Function URL is locked behind CloudFront OAC — do not expose it
  directly.

## Known operational gaps (context, so agents don't "discover" them as new)
- **P0 — no account recovery.** Password reset and email verification are
  absent (not stubbed). A locked-out user has no automated path. This is the
  top-priority product gap.
- **Mail is a stub** (`MAIL_TRANSPORT=outbox`, SES unwired). Any flow needing
  email does not actually send yet.
- Safe Browsing is off without a key. Several AWS-egress features (webhooks,
  OAuth JWKS, mail, Safe Browsing) are non-functional under
  `natStrategy='none'` and are synth-proven only — never run against real AWS.
- Global form-slug namespace is squattable + a cross-tenant existence leak —
  a knowingly-deferred trade-off, documented in DECISIONS. Don't "fix" it
  ad hoc without reading the ADR first.

## Privacy is a feature, protect it
- Click analytics are cookieless: daily-salt visitor hashing with a
  k-anonymity floor. Do not add a persistent visitor cookie, store a raw IP, or
  drop the k-anonymity floor — the privacy-first analytics story is a
  competitive differentiator, not incidental.

## Multi-tenancy
- Workspaces with role-based membership + 2FA. Every data query is
  workspace-scoped. A new query that can read across workspace boundaries is a
  security bug — scope it.
