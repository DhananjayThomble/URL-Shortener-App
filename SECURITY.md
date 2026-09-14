# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

SnapURL is a URL shortener. A working proof-of-concept for an open redirect, a
stored XSS on a bio page, or a workspace-isolation bypass is immediately usable
against every running instance — including self-hosted ones whose operators have
not patched yet. Publishing one before a fix exists puts those operators' users at
risk.

Report privately instead, via **[GitHub Security Advisories][advisories]** —
"Report a vulnerability" on the Security tab. That opens a private thread visible
only to you and the maintainers, and it is the preferred channel because the fix,
the CVE, and the disclosure are all coordinated in one place.

[advisories]: https://github.com/DhananjayThomble/URL-Shortener-App/security/advisories/new

### What to include

- What an attacker can do, and what they need to start (an account? a workspace?
  nothing at all?)
- Reproduction steps, ideally against a local stack (`pnpm db:up && pnpm dev`, or
  `pnpm staging:up`) rather than a live deployment
- Affected component — `apps/api`, `apps/redirect`, `apps/worker`, `web`,
  `apps/extension`, `packages/*`, or the CDK infrastructure in `infra/`
- The commit or version you tested

### What to expect

This is a small project, maintained without a dedicated security team. Honest
expectations rather than promises we cannot keep:

| | |
| --- | --- |
| First response | within 7 days |
| Assessment and severity | within 14 days |
| Fix for high/critical | as fast as we reasonably can, prioritised over features |
| Credit | offered in the advisory unless you prefer to stay anonymous |

If you do not hear back within 7 days, please ping the thread — it means the
notification was missed, not that the report was ignored.

## Scope

### In scope

- Authentication and session handling, including token rotation and revocation
- Workspace isolation — any path where one workspace can read or modify another's
  links, analytics, members, domains, or bio pages
- Authorization and role enforcement (`owner` / `admin` / `member`)
- **Open redirect** via the routing chain, deep links, or destination validation
- Stored or reflected **XSS**, particularly on user-rendered surfaces such as bio
  pages, link titles, and form submissions
- SQL injection, SSRF, and template injection
- Abuse-control bypass — a link flagged by an operator that keeps redirecting
- Secrets exposure in the repository, build output, or deployed artifacts
- Privilege escalation in the self-hosted deployment paths (`infra/`, Helm, compose)

### Out of scope

- Denial of service, volumetric or otherwise — please do not test this against any
  deployment you do not own
- Findings that require a compromised host, a malicious browser extension, or
  physical access
- Missing hardening headers with no demonstrated impact
- Automated scanner output with no working proof of concept
- Social engineering of maintainers or users
- Vulnerabilities in third-party dependencies with no SnapURL-specific exploit path
  — report those upstream (though do tell us if we are pinning a vulnerable version)

## Testing guidelines

Please test against **your own local or self-hosted instance**, never against
another operator's deployment. The repository gives you a complete stack:

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev   # development
pnpm staging:up                                             # data-isolated staging
```

Do not access, modify, or retain data belonging to anyone else. If you encounter
someone else's data during testing, stop and include that fact in your report.

Good-faith research that follows this policy will not be pursued as a breach of
terms. We will not take legal action against researchers who report responsibly
and give us reasonable time to fix the issue.

## Reporting link abuse (not a vulnerability)

If a **short link** is being used for phishing, malware, or other abuse, that is a
content report rather than a security vulnerability in the software. For a hosted
instance, use that instance's abuse-report route. For a self-hosted instance,
contact its operator — the maintainers of this repository do not control links
created on deployments they do not run.

## Supported versions

Security fixes land on `main` and are released from there. There are no long-term
support branches; self-hosters should track `main` or the most recent release tag.
