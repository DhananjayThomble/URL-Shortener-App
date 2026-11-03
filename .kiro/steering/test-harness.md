# SnapURL — Test-harness configuration (steering)

How a test stack is configured so a test exercises the thing under test without
fighting a production safety control. The rule under all of this: **a test bends
the HARNESS, never a product default.**

## Switch features on at the harness, with generous caps
- Paid features and their caps ship **OFF** by default (see `billing.md`). A
  suite that needs a paid feature (custom domains, billing endpoints) turns the
  kill switch ON in its own stack setup with a cap well clear of what the suite
  does — not by lowering the production default.
- Likewise, lift volume limits at the harness: `THROTTLE_LIMIT` raises only the
  global bucket for a suite that makes many requests; the route-level limits stay
  (they are a security control the suites back off on).

## New-account link window
- Test stacks set `NEW_ACCOUNT_LINK_WINDOW_DAYS=0` so a freshly-seeded account's
  links are not held pending verification during the run. Production keeps the
  7-day default; that behaviour is covered by its own unit tests, so a harness
  with the window at 0 is not weakening coverage.

## Never weaken a product default to make a test pass
- Do not make a production rate limit test-adjustable, forge a JWT, add blind
  `sleep`s or retries to mask a timing bug, or lower a cap in shipped config. If
  a test can only pass by changing shipped behaviour, the test found a real bug —
  fix the code (see `testing.md`, R1).

## Isolate shared infrastructure
- `docker run` is denied in CI; reuse a shared container but create a SEPARATE
  database inside it (`CREATE DATABASE wt<issue>`) so you never touch a DB other
  workers depend on, and drop it when done.
- Seed data (e.g. `apps/api/src/stack/principals.ts`) runs only against a
  throwaway staging DB, never a real tenant.
