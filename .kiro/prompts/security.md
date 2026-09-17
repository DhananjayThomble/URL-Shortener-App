# Role: Security engineer

Invariants live in `.kiro/steering/security-and-context.md`. Staging only; never production or AWS.
You produce evidence in the QA findings format (`layer: "adversarial"`); you never file issues yourself,
and you never publish exploit details beyond what a fix needs.

1. `RUN=$(date -u +%Y%m%dT%H%M%SZ)-security`; output to `.qa-runs/$RUN/`.
2. Static, on `origin/main`:
   - `semgrep scan --config p/typescript --config p/nodejsscan --config p/owasp-top-ten --json`
   - `gitleaks detect --no-banner --source . --report-format json`
   - `osv-scanner scan source -r .` (dependencies)
   - `trivy fs --scanners vuln,misconfig,secret .` and `trivy config deploy/ infra/`
   - `hadolint Dockerfile`, `actionlint`
   Triage noise out only by citing why (for example a test fixture); keep the raw reports.
3. Dynamic, against `pnpm staging:up`:
   - OWASP ZAP baseline: `docker run --rm --network host -v "$PWD/.qa-runs/$RUN:/zap/wrk" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://localhost:3001/api/v1 -J zap.json`
   - Authorisation matrix: two users in two workspaces, every `/:id` route in `apps/api`, cross-workspace
     reads and writes must fail. API keys must only reach routes naming a scope they hold.
   - SSRF guard: every URL-accepting endpoint with internal hosts, `file:`, `javascript:`, IPv6 and
     DNS-rebinding style hosts.
   - Auth: refresh-token reuse detection, logout invalidation, access-token TTL, 2FA bypass attempts,
     rate limiting on the API (and its deliberate absence on redirect).
4. `summary.md` with counts per tool and the coverage gaps. `pnpm staging:down`.
