# Design spike: custom-domain SSL at scale

**Status:** Spike / decision proposal (no code change in this PR)
**Date:** 2026-11-01
**Scope:** How SnapURL should issue and auto-renew TLS certificates for tenant
custom domains (e.g. `r.gridlock.pro`) at the scale a free, open-source product
with many signups implies. Read-only research + this document. No infra/app
code is changed and nothing is deployed here.

---

## 1. Current state (verified from the code at `0d3df1c`)

Custom-domain SSL does not work today: the Domains UI shows SSL **"Pending"**
indefinitely. The relevant pieces, confirmed by reading the source:

### 1.1 One CloudFront distribution, one platform certificate

`infra/lib/snapurl-stack.ts` (the `RedirectCdn` distribution, ~line 1125):

```ts
const distribution = new cloudfront.Distribution(this, "RedirectCdn", {
  // ...
  domainNames: props.domainName ? [props.domainName] : undefined,
  certificate: props.certificate,
  comment: "SnapURL redirect edge",
});
```

`domainNames` is a **one-element** array and the code comment states plainly:
*"this stack only ever builds one certificate for one name."* The certificate is
`props.certificate`, created at **build/deploy time** in `infra/bin/snapurl.ts`
as a single us-east-1 ACM certificate for the **platform domain only**:

```ts
// infra/bin/snapurl.ts
const domainName = app.node.tryGetContext("domainName") as string | undefined;
if (domainName) {
  const certStack = new ... ({ env: { account, region: "us-east-1" }, ... });
  certificate = new acm.Certificate(certStack, "Certificate", {
    domainName,
    validation: acm.CertificateValidation.fromDns(),
  });
}
```

There is no mechanism to add a tenant's domain to this distribution or to issue a
certificate for it.

### 1.2 Ownership is verified, but SSL is a stub

`apps/api/src/domains/domains.service.ts`:

- `add()` writes `status: "verifying"`, `ssl: "pending"`, and a TXT
  `verificationToken` (`snapurl-verify-<hex>`).
- `verify()` checks the TXT record at `_snapurl.<domain>` and flips
  `status` → `"live"`. **`ssl` deliberately stays `"pending"`**, with this
  comment:

  > *"ssl stays 'pending' here on purpose. Ownership is proven, but the
  > certificate is a separate asynchronous process — ACM issues it, CloudFront
  > has to accept it as an alternate domain name, and that takes minutes. … The
  > worker moves ssl to 'active'."*

**No such worker job exists.** A repo-wide search for runtime certificate code
(`RequestCertificate`, `@aws-sdk/client-acm`, `addAlias`, `associate-alias`,
`alternateDomainNames`, any `ACM` client) across `apps/**/*.ts` returns **zero
matches**. The only production writer of `ssl: "active"` is
`apps/api/src/auth/auth.service.ts:176`, which bootstraps the **shared system
domain** at registration (`isSystem: true`, no per-tenant renewal). Every other
`ssl: "active"` occurrence is a test fixture.

So: ownership verification is real; certificate issuance is an **unbuilt stub**.
A verified custom domain is reachable over HTTP via the DNS record
`domains.routing.ts` emits (a CNAME/A to `DEFAULT_DOMAIN`), but there is no
certificate for it, so HTTPS fails and the UI's SSL column never leaves Pending.

### 1.3 The naive approach is disqualified by a hard limit

The obvious fix — "attach each tenant's domain as an alternate name (CNAME) on
the single `RedirectCdn` distribution and let ACM cover them" — does not scale.
A standard CloudFront distribution has a default quota of **100 alternate domain
names (CNAMEs) per distribution** ([AWS CloudFront quotas][cf-quotas], accessed
2026-11-01), raisable only modestly by a quota-increase request. A single ACM
certificate also defaults to 10 domain names (raisable to ~100). With "many
signups each bringing their own domain", 100 is reached quickly and there is no
path to thousands on one distribution. **This is the disqualifier for the naive
single-distribution approach and the reason a real option is needed.**

### 1.4 The UI makes a false promise today

`web/src/app/(app)/domains/page.tsx:173`:

```tsx
sub="Bring your own domain. SSL is issued automatically and renews itself."
```

Nothing issues or renews a tenant certificate, so this copy is currently false.
`web/src/lib/domain-state.ts` renders the `ssl: "pending"` state as a "Pending"
badge — accurate, but paired with a page subtitle that over-promises. See §6 for
the interim fix.

---

## 2. The three options

For each option: certificate issuance + auto-renewal, the realistic per-tenant
scaling ceiling, concrete monthly cost at **100 / 1,000 / 10,000** tenant
domains, the CDK/architecture change, the DNS records the **end user** must add,
operational burden, and key risks. All pricing/limit numbers are cited in §5
with source URLs and the 2026-11-01 access date.

### Option A — AWS CloudFront SaaS Manager (multi-tenant distribution + per-tenant ACM)

**What it is.** A CloudFront feature (GA April 2025) built for exactly this
problem. A **multi-tenant distribution** is a template (origins, cache
behaviors, security). Each tenant becomes a **distribution tenant** that can
carry its own domain and its own ACM certificate while sharing the template's
infrastructure. ([AWS SaaS Manager announcement][cf-saas-blog], accessed
2026-11-01.)

**Cert issuance + renewal.** Per-tenant certificates are issued through **AWS
Certificate Manager**. ACM public certificates used with ACM-integrated services
(CloudFront is one) are **free** and **auto-renew** with no private-key handling
([ACM pricing / AWS docs][acm-free], accessed 2026-11-01). SaaS Manager can
issue per-tenant certs or inherit a wildcard from the template distribution.

**Scaling ceiling.** Designed for scale. AWS raised the default quotas to
**1,000,000 distribution tenants per account** and **500 multi-tenant
distributions per account** ([CloudFront developer-guide What's New][cf-whatsnew],
accessed 2026-11-01). This clears 10k tenants comfortably — the single-
distribution 100-CNAME cap (§1.3) does **not** apply to the per-tenant model.

**Monthly cost (no separate SaaS Manager license fee).** SaaS Manager itself
adds no per-tenant license charge; you pay standard CloudFront usage (data
transfer out + HTTPS requests) plus free ACM. For a URL shortener the per-tenant
*fixed* cost is therefore ≈ **$0** — the bill is dominated by redirect traffic
volume, which is independent of how certificates are provisioned. Standard
CloudFront list egress starts around **$0.085–$0.09/GB** and HTTPS requests
around **$0.01 per 10,000** ([CloudFront pricing][cf-pricing], accessed
2026-11-01); the first **1 TB/month egress and 10M requests are in the perpetual
free tier** ([CloudFront free-tier expansion][cf-freetier], accessed 2026-11-01).

| Tenant domains | Fixed SSL/cert cost/mo | Notes |
|---|---|---|
| 100 | ~$0 | ACM free; only redirect traffic billed |
| 1,000 | ~$0 | same |
| 10,000 | ~$0 | within 1M-tenant quota; only redirect traffic billed |

A 302-redirect payload is tiny (hundreds of bytes), so even millions of
redirects/month stay near or inside the 1 TB free tier. **Cert provisioning is
effectively free at every scale; the cost crux at 1k/10k is traffic, which SnapURL
already pays regardless.**

**CDK / architecture change.** Largest of the three. Replace the single
`RedirectCdn` standard distribution with a **multi-tenant (template)
distribution** and provision a **distribution tenant per custom domain** at
runtime (CloudFront `CreateDistributionTenant` + ACM `RequestCertificate` with
DNS validation) — the worker §1.2 promised. Net-new runtime AWS SDK code in
`apps/api`/worker, IAM grants for ACM + CloudFront tenant APIs, and a state
machine from `ssl: pending` → DNS-validation-pending → `active`. L2 CDK support
for multi-tenant distributions is still thin, so expect L1/`Cfn*` or SDK calls.

**DNS records the end user adds.**
1. **Ownership (already built):** TXT at `_snapurl.<domain>` = the
   `verificationToken`.
2. **Certificate validation:** a **CNAME** that ACM DNS-validation generates
   (`_<token>.<domain>` → `_<token>.acm-validations.aws`).
3. **Routing:** a **CNAME** from their domain to the CloudFront endpoint (or
   apex A/ALIAS).

**Operational burden.** ACM auto-renews, so steady state is low. Burden is in
the issuance pipeline: handling ACM validation that never completes (user never
adds the CNAME), retry/backoff, surfacing per-domain failures, and quota
management. All-AWS, so no second vendor; strong lock-in to CloudFront/ACM.

**Key risks.** Newer feature with evolving CDK/L2 support; building and
maintaining the issuance state machine is non-trivial; relatively fewer
community references than Cloudflare for SaaS.

---

### Option B — Cloudflare for SaaS (custom hostnames) fronting the existing CloudFront/Lambda origin

**What it is.** Put **Cloudflare for SaaS "custom hostnames"** in front of the
existing stack. Cloudflare terminates TLS for each tenant hostname and proxies
to SnapURL's current CloudFront (or Lambda Function URL) as the origin. SnapURL's
architecture below Cloudflare is unchanged.

**Cert issuance + renewal.** Cloudflare issues and **auto-renews** a certificate
per custom hostname automatically once the tenant's CNAME points at Cloudflare.
No ACM, no CloudFront alias wrangling. This is Cloudflare's purpose-built
multi-tenant TLS product.

**Scaling ceiling.** **50,000** custom hostnames on the Free/Pro/Business
pay-as-you-go plans; Enterprise is unlimited (contact sales above 50,000)
([Cloudflare for SaaS plans][cf4saas-plans], accessed 2026-11-01). 50k clears
the 10k target with headroom.

**Monthly cost.** **First 100 custom hostnames included free**, then
**$0.10 per custom hostname per month** ([Cloudflare for SaaS plans][cf4saas-plans],
accessed 2026-11-01). This is a *per-tenant fixed* fee — the one option whose
cost grows linearly with signups:

| Tenant domains | Billable hostnames | Cost/mo |
|---|---|---|
| 100 | 0 (all within the 100 included) | **$0** |
| 1,000 | 900 | 900 × $0.10 = **$90/mo** |
| 10,000 | 9,900 | 9,900 × $0.10 = **$990/mo** |

Plus a plan subscription if one is needed for the zone (Pro $25/mo, Business
$250/mo billed monthly — [Cloudflare plans][cf-plans], accessed 2026-11-01);
custom hostnames are available on PAYG. **This is the decisive number for a
free/no-revenue product: ~$90/mo at 1k tenants and ~$990/mo at 10k tenants, with
no revenue behind it.**

**CDK / architecture change.** Smallest infra change to SnapURL itself — the
CloudFront/Lambda origin stays as-is. Instead you integrate the **Cloudflare API**
(create/delete custom hostname, poll status) into `apps/api`/worker, store a
Cloudflare API token as a secret, and manage a second vendor's zone. No ACM/
CloudFront-alias code.

**DNS records the end user adds.**
1. **Ownership (already built):** the existing TXT at `_snapurl.<domain>`.
2. **Routing + TLS validation:** a **CNAME** from their domain to the
   Cloudflare SaaS fallback/origin hostname SnapURL provides. Cloudflare may also
   require a TXT for hostname pre-validation (DCV).

**Operational burden.** Low renewal burden (Cloudflare handles it). But it is a
**second vendor**: a Cloudflare account, a billing relationship, an API token to
rotate, and a second status surface to monitor. Vendor lock-in to Cloudflare for
the TLS layer.

**Key risks.** Linear cost with signups is the problem for a free product;
dependency on and lock-in to a second vendor; the per-hostname fee can become
the product's single largest line item well before 10k tenants.

---

### Option C — Shared `snapurl.in` subdomain for the free tier + custom-domain SSL gated to a future paid tier

**What it is.** Don't issue per-tenant certificates for free users at all. The
free tier gets a **subdomain of the already-TLS-covered platform domain** (e.g.
`alice.snapurl.in` or `go.snapurl.in/alice`), served by the existing single
distribution and its existing wildcard/platform certificate. Custom domains with
their own SSL become a **paid-tier** feature, implemented later via Option A or B
**only for paying tenants** — where the per-tenant cost is covered by revenue.

**Cert issuance + renewal.** None per tenant for the free tier. `*.snapurl.in`
is covered by one platform wildcard ACM certificate that **auto-renews for
free** (already the model for the system domain). A free-tier subdomain is
`ssl: "active"` the moment it is created.

**Scaling ceiling.** Effectively **unlimited** free tenants — they are rows
pointing at one shared wildcard-covered domain, with **no per-tenant
certificate** and no CNAME-alias consumption (a wildcard cert covers all
subdomains under one SAN entry). The only per-tenant SSL cost arrives with the
*paid* tier, which is bounded by paying-customer count.

**Monthly cost.**

| Tenant domains (free tier) | Cost/mo | Notes |
|---|---|---|
| 100 | ~$0 | one wildcard cert (free ACM) + shared traffic |
| 1,000 | ~$0 | same wildcard; no per-tenant cert |
| 10,000 | ~$0 | same wildcard; no per-tenant cert |

Custom-domain SSL cost is deferred to the paid tier and is then funded by that
tier's revenue (and can itself use Option A's ~$0 fixed-cost model). **This is
the only option whose free-tier cost is flat ~$0 at every scale.**

**CDK / architecture change.** Smallest overall. Requires a wildcard
`*.snapurl.in` ACM cert on the distribution (one-element `domainNames` → add the
wildcard; a one-line infra change) and app logic to mint free-tier subdomains
under the shared domain. The existing `isSystem` shared-domain plumbing and
`routingRecordFor` already point tenants at `DEFAULT_DOMAIN`, so most of the
free-tier mechanics exist. No runtime ACM/alias issuance for the free tier.

**DNS records the end user adds.**
- **Free tier:** **none** — they use a SnapURL-owned subdomain.
- **Paid tier (later):** whatever Option A or B requires (TXT + validation CNAME
  + routing CNAME).

**Operational burden.** Lowest. One wildcard cert to keep (auto-renewing, same
as today's platform cert). No per-tenant issuance pipeline, no second vendor, no
quota juggling, until/unless the paid tier is built.

**Key risks.** It is a **product decision, not just a technical one**: "bring
your own domain" becomes paid, which may conflict with positioning. A wildcard
`*.snapurl.in` cert does not cover a user's **own** domain — so this option on
its own does **not** deliver `r.gridlock.pro` for free users; it reframes the
promise rather than fulfilling it.

---

## 3. Side-by-side summary

| | A. CloudFront SaaS Manager | B. Cloudflare for SaaS | C. Shared subdomain (free) + paid custom |
|---|---|---|---|
| Per-tenant cert | ACM, free, auto-renew | Cloudflare, auto-renew | none (free tier); A/B for paid |
| Scaling ceiling | ~1,000,000 tenants/acct | 50,000 (PAYG), unlimited (Ent.) | unlimited free; paid bounded by revenue |
| Cost @100 | ~$0 | $0 | ~$0 |
| Cost @1,000 | ~$0 (traffic only) | **~$90/mo** | ~$0 |
| Cost @10,000 | ~$0 (traffic only) | **~$990/mo** | ~$0 |
| Infra change | Large (multi-tenant dist + issuance pipeline) | Small infra, + Cloudflare API & 2nd vendor | Smallest (wildcard cert + subdomain logic) |
| 2nd vendor | No (all AWS) | Yes (Cloudflare) | No |
| Delivers BYO-domain to free users | Yes | Yes | **No** (free users get a subdomain) |

---

## 4. Recommendation

**Primary: Option A (CloudFront SaaS Manager) for custom-domain SSL, staged in
behind Option C's free-tier subdomains as the immediate shippable step.**

Rationale, tied to the free/OSS economics (no revenue behind the cost):

1. **Cost is the deciding axis, and A wins it.** The product is free with no
   revenue, so a per-tenant fixed fee is the thing to avoid. Option B costs
   **~$90/mo at 1k and ~$990/mo at 10k** tenants — a recurring, revenue-less
   bill that scales with the product's own success. Option A's per-tenant cert
   cost is **~$0** (ACM is free, SaaS Manager adds no license fee); the only
   bill is redirect traffic, which SnapURL pays under *any* option. A is the
   affordable path at 1k and 10k.

2. **A clears the scale with no second vendor.** 1,000,000-tenant and
   500-distribution quotas clear 10k comfortably, it stays entirely within the
   existing AWS account/IAM/billing, and it is the feature AWS built for this
   exact problem — no new vendor relationship, token rotation, or second status
   surface.

3. **C is the right immediate move and de-risks A.** A's issuance pipeline is
   real work. Ship **Option C first**: give free users
   `<name>.snapurl.in` under a wildcard cert (already-TLS, ~$0, no issuance
   pipeline), which makes "bring your own domain" honest as a *subdomain* today
   and removes the broken Pending state for the common case. Then build Option A
   to deliver true custom domains (`r.gridlock.pro`) — offered to all tenants,
   since A's cost is ~$0, or gated to a paid tier if the product wants that
   later. C and A compose; C is not a dead end.

**Why not B as primary:** it is operationally the easiest and its TLS is
genuinely turnkey, but the linear per-hostname fee is disqualifying for a
free/no-revenue product at 1k+ tenants. Keep B as a **fallback** if Option A's
multi-tenant/CDK maturity proves too costly to build and maintain — but only
with a cost ceiling in mind.

---

## 5. Implementation outline for the recommended path (A, staged behind C)

Not built in this PR — this is the plan the recommendation implies.

**Phase 0 — stop the false promise (this is §6, do immediately).** Soften the UI
copy so it stops claiming automatic SSL for custom domains.

**Phase 1 — Option C free-tier subdomains.**
- `infra`: add a `*.snapurl.in` wildcard to the distribution's `domainNames`
  (plus wildcard ACM cert in us-east-1). One targeted infra change; `cdk diff`
  first (per house rule — a diff caught destructive flag omissions before).
- `apps/api/src/domains`: mint a free-tier subdomain under the shared system
  domain at signup/first-link; set `ssl: "active"` immediately (covered by the
  wildcard). Reuse the existing `isSystem` shared-domain and `routingRecordFor`
  plumbing.

**Phase 2 — Option A custom-domain issuance (the missing worker from §1.2).**
- `infra`: convert `RedirectCdn` to a multi-tenant/template distribution (expect
  L1 `Cfn*`/SDK; L2 support is thin). IAM: grant the worker `acm:RequestCertificate`,
  `acm:DescribeCertificate`, and CloudFront distribution-tenant APIs.
- `apps/api/src/domains/domains.service.ts`: after `verify()` flips `status:
  "live"`, enqueue a cert-issuance job instead of leaving `ssl: "pending"` inert.
- **New worker/cert-issuance step:** `RequestCertificate` (DNS validation) →
  surface the ACM validation CNAME to the user in the Domains UI → poll ACM →
  on `ISSUED`, create/attach the CloudFront distribution tenant for the domain →
  flip **`ssl: "pending"` → `"active"`** and set `sslRenewsAt`. Handle the
  never-validated case (user never adds the CNAME): timeout, `ssl: "failed"`,
  surfaced in the UI (`domain-state.ts` already renders `failed`).
- The DTO/`domain-state.ts` states already exist (`pending`/`active`/`failed`,
  `sslRenewsAt`) — the work is the issuance state machine behind them, not the UI
  model.

**Reviews:** per house rules, route the infra + IAM diff through `cdk diff` and
an independent expert review before any deploy; this spike authorises none of it.

---

## 6. Interim fix for the misleading UI copy

Until issuance exists, the Domains page must stop asserting automatic SSL — the
same honesty the docs already apply to the Safe Browsing "scanned on creation"
caveat. Concretely (to be done in a separate PR, not here):

- `web/src/app/(app)/domains/page.tsx:173` — change the subtitle from
  `"Bring your own domain. SSL is issued automatically and renews itself."` to
  something that does not over-promise, e.g.
  *"Bring your own domain. SSL for custom domains is coming soon — until then,
  verified domains work over HTTP."* (or, once Phase 1 ships, point users at the
  shared `*.snapurl.in` subdomain which is HTTPS today).
- Optionally add a short caveat next to the SSL "Pending" badge
  (`web/src/lib/domain-state.ts`) explaining it will remain pending until custom-
  domain SSL ships, mirroring the Safe Browsing caveat pattern.

This keeps the UI truthful about a currently-unbuilt capability without touching
any issuance code.

---

## 7. Sources (all accessed 2026-11-01)

- [cf-quotas] AWS — CloudFront quotas (alternate domain names per distribution = 100 default): https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html
- [cf-saas-blog] AWS — "Reduce your operational overhead today with Amazon CloudFront SaaS Manager" (GA, multi-tenant distributions + distribution tenants + ACM): https://aws.amazon.com/blogs/aws/reduce-your-operational-overhead-today-with-amazon-cloudfront-saas-manager/
- [cf-whatsnew] AWS — CloudFront Developer Guide "What's New" (distribution tenants quota raised 10,000 → 1,000,000; multi-tenant distributions 20 → 500): https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/WhatsNew.html
- [acm-free] AWS — ACM / AWS Managed Services docs ("Public and private certificates provisioned through AWS Certificate Manager for use with ACM-integrated services are free"): https://aws.amazon.com/certificate-manager/pricing/
- [cf-pricing] AWS — CloudFront pricing (standard egress ~$0.085–0.09/GB, HTTPS requests ~$0.01 / 10k): https://aws.amazon.com/cloudfront/pricing/
- [cf-freetier] AWS — CloudFront free-tier expansion (1 TB egress + 10M requests/mo, perpetual): https://aws.amazon.com/blogs/aws/aws-free-tier-data-transfer-expansion-100-gb-from-regions-and-1-tb-from-amazon-cloudfront-per-month/
- [cf4saas-plans] Cloudflare — Cloudflare for SaaS plans (100 hostnames included; $0.10 per additional hostname/mo; max 50,000 PAYG; Enterprise unlimited): https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- [cf-plans] Cloudflare — plan pricing (Pro $25/mo, Business $250/mo billed monthly): https://www.cloudflare.com/plans/

> Note on pricing precision: AWS CloudFront and ACM list prices vary by region
> and change over time; the per-GB/request figures above are order-of-magnitude
> list rates for sizing, not a quote. The load-bearing claims for the
> recommendation — **ACM public certs are free**, **SaaS Manager adds no
> per-tenant license fee**, and **Cloudflare for SaaS is $0.10/hostname/mo above
> 100** — are the cited ones. Re-confirm regional CloudFront egress rates at
> deploy-planning time.
