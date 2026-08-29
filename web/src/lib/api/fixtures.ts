import { z } from "zod";
import type {
  Analytics,
  ApiKey,
  AuditEntry,
  AuthSession,
  BioPage,
  ConversionsReport,
  CreatedApiKey,
  CreatedWebhook,
  Domain,
  Link,
  Member,
  MemberRole,
  PublicLinkPreview,
  RecordConversionInput,
  TotpRecoveryCodes,
  TotpSetup,
  UnlockLinkResult,
  UpdateLinkInput,
  UpdateWorkspaceInput,
  UpsertBioPageInput,
  Webhook,
  Workspace,
} from "./types";

/* ============================================================
   Stand-in data for the endpoints NestJS hasn't shipped yet.

   Everything here matches the zod schemas in types.ts, so when the
   real API arrives the components don't change — only the env flag.
   Nothing in this file is imported unless NEXT_PUBLIC_USE_FIXTURES
   is on; the dynamic import in client.ts keeps it out of the bundle.
   ============================================================ */

const spark = (seed: number, n = 15) => {
  const out: number[] = [];
  let v = seed;
  for (let i = 0; i < n; i++) {
    v = Math.max(4, v * (0.94 + ((i * 37 + seed) % 23) / 100));
    out.push(Math.round(v));
  }
  return out;
};

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

export const WORKSPACE: Workspace = {
  id: "ws_acme",
  name: "Acme Growth",
  slug: "acme-growth",
  initials: "AC",
  plan: "Growth",
  defaultDomain: "snap.to",
  defaultRedirect: "302",
  clicksUsed: 412908,
  clicksIncluded: 1000000,
  retentionYears: 3,
  cookielessAnalytics: true,
  scanOnCreate: true,
  publicPreviews: true,
  currency: "INR",
};

export const LINKS: Link[] = [
  {
    id: "lnk_spring",
    domain: "snap.to",
    slug: "spring-sale",
    destination: "https://acme.com/collections/spring-2026",
    title: "Spring Sale 2026 — up to 40% off",
    comment: "Main Instagram story link for the spring push",
    tags: ["campaign/spring", "social"],
    folder: "Campaigns / Spring 2026",
    status: "active",
    clicks: 84392,
    uniqueClicks: 61204,
    redirectType: "302",
    rules: [
      { id: "r1", when: { country: "IN" }, then: "https://acme.in/spring" },
      { id: "r2", when: { device: "ios" }, then: "https://apps.apple.com/acme" },
      { id: "r3", when: {}, then: "https://acme.com/spring-2026", weight: 50 },
    ],
    expiresAt: daysAgo(-34),
    clickLimit: null,
    passwordProtected: true,
    forwardQuery: true,
    deepLink: true,
    hideReferrer: false,
    publicPreview: true,
    cloaked: false,
    safeBrowsing: { status: "clean", checkedAt: daysAgo(0.003) },
    utm: { source: "instagram", medium: "social", campaign: "spring_2026", content: "story_swipe_up" },
    social: {
      title: "Spring Sale 2026 — up to 40% off",
      description: "Everything in the spring collection, now through 30 September.",
      image: null,
    },
    sparkline: spark(42),
    createdAt: daysAgo(166),
    createdBy: "Priya Raman",
  },
  {
    id: "lnk_app",
    domain: "snap.to",
    slug: "app",
    destination: "https://apps.apple.com/acme/download",
    title: "Download the Acme app",
    tags: ["product"],
    folder: "Product",
    status: "active",
    clicks: 61240,
    uniqueClicks: 44118,
    redirectType: "302",
    rules: [
      { id: "r1", when: { device: "ios" }, then: "https://apps.apple.com/acme" },
      { id: "r2", when: { device: "android" }, then: "https://play.google.com/acme" },
      { id: "r3", when: {}, then: "https://acme.com/download" },
    ],
    expiresAt: null,
    clickLimit: null,
    passwordProtected: false,
    forwardQuery: true,
    deepLink: true,
    hideReferrer: false,
    publicPreview: true,
    cloaked: false,
    safeBrowsing: { status: "clean", checkedAt: daysAgo(0.08) },
    utm: null,
    social: null,
    sparkline: spark(80),
    createdAt: daysAgo(320),
    createdBy: "Arjun Kapoor",
  },
  {
    id: "lnk_demo",
    domain: "go.acme.com",
    slug: "demo",
    destination: "https://calendly.com/acme/demo?team=sales",
    title: "Book a demo",
    tags: ["sales"],
    folder: "Sales",
    status: "active",
    clicks: 44118,
    uniqueClicks: 31006,
    redirectType: "302",
    rules: [
      { id: "r1", when: { country: "US" }, then: "https://calendly.com/acme-us" },
      { id: "r2", when: {}, then: "https://acme.com/book-a-demo" },
    ],
    expiresAt: null,
    clickLimit: null,
    passwordProtected: false,
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
    cloaked: false,
    safeBrowsing: { status: "clean", checkedAt: daysAgo(0.4) },
    utm: { source: "google", medium: "cpc", campaign: "demo_q3", content: null },
    social: null,
    sparkline: spark(20),
    createdAt: daysAgo(88),
    createdBy: "Sara Mehta",
  },
  {
    id: "lnk_pricing",
    domain: "snap.to",
    slug: "pricing",
    destination: "https://acme.com/pricing",
    title: "Pricing",
    tags: ["product", "docs"],
    folder: "Product",
    status: "active",
    clicks: 31006,
    uniqueClicks: 24880,
    redirectType: "301",
    rules: [{ id: "r1", when: {}, then: "https://acme.com/pricing" }],
    expiresAt: null,
    clickLimit: null,
    passwordProtected: false,
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
    cloaked: false,
    safeBrowsing: { status: "clean", checkedAt: daysAgo(1) },
    utm: null,
    social: null,
    sparkline: spark(58),
    createdAt: daysAgo(410),
    createdBy: "Priya Raman",
  },
  {
    id: "lnk_beta",
    domain: "snap.to",
    slug: "beta-invite",
    destination: "https://acme.com/beta/signup",
    title: "Private beta invite",
    tags: ["private"],
    folder: "Product",
    status: "expiring",
    clicks: 412,
    uniqueClicks: 388,
    redirectType: "302",
    rules: [{ id: "r1", when: {}, then: "https://acme.com/beta/signup" }],
    expiresAt: null,
    clickLimit: 500,
    passwordProtected: true,
    forwardQuery: false,
    deepLink: false,
    hideReferrer: true,
    publicPreview: false,
    cloaked: false,
    safeBrowsing: { status: "clean", checkedAt: daysAgo(2) },
    utm: null,
    social: null,
    sparkline: spark(12),
    createdAt: daysAgo(21),
    createdBy: "Dhananjay Thomble",
  },
  {
    id: "lnk_launch",
    domain: "snap.to",
    slug: "spring-launch",
    destination: "https://acme.com/spring",
    title: "Spring launch",
    tags: ["campaign/spring"],
    folder: "Campaigns",
    status: "scheduled",
    clicks: 0,
    uniqueClicks: 0,
    redirectType: "302",
    rules: [],
    expiresAt: null,
    // The case the feature exists for: printed now, live later, and anyone who
    // scans it early lands somewhere deliberate rather than on an error.
    activatesAt: daysAgo(-9),
    scheduledTo: "https://acme.com/spring/coming-soon",
    clickLimit: null,
    passwordProtected: false,
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
    cloaked: false,
    safeBrowsing: { status: "clean", checkedAt: daysAgo(1) },
    utm: null,
    social: null,
    // Flat zero, not spark(0), which floors at 4 — a link with no clicks yet
    // should not draw a line.
    sparkline: Array(15).fill(0),
    createdAt: daysAgo(3),
    createdBy: "Dhananjay Thomble",
  },
  {
    id: "lnk_webinar",
    domain: "go.acme.com",
    slug: "webinar-q3",
    destination: "https://acme.com/events/q3-webinar",
    title: "Q3 webinar",
    tags: ["campaign/q3"],
    folder: "Campaigns / Q3",
    status: "expired",
    clicks: 18402,
    uniqueClicks: 14208,
    redirectType: "302",
    rules: [{ id: "r1", when: {}, then: "https://acme.com/events" }],
    expiresAt: daysAgo(6),
    clickLimit: null,
    passwordProtected: false,
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
    cloaked: false,
    safeBrowsing: { status: "clean", checkedAt: daysAgo(7) },
    utm: null,
    social: null,
    sparkline: [92, 88, 81, 74, 66, 58, 49, 41, 32, 24, 17, 11, 6, 3, 1],
    createdAt: daysAgo(120),
    createdBy: "Arjun Kapoor",
  },
];

const SERIES = [
  180, 196, 188, 214, 208, 241, 232, 268, 254, 289, 301, 294, 332, 348, 372,
].map((clicks, i) => ({
  date: daysAgo(14 - i).slice(0, 10),
  clicks: clicks * 111,
  unique: Math.round(clicks * 111 * 0.7),
  scans: Math.round(clicks * 111 * 0.15),
}));

export const ANALYTICS: Analytics = {
  totals: { clicks: 412908, unique: 288104, scans: 61882, conversions: 12440, blocked: 37 },
  deltas: { clicks: 22.6, unique: 15.2, scans: 41.0, conversions: -2.4 },
  series: SERIES,
  countries: [
    { label: "India", value: 148220, icon: "🇮🇳" },
    { label: "United States", value: 92104, icon: "🇺🇸" },
    { label: "United Kingdom", value: 41880, icon: "🇬🇧" },
    { label: "UAE", value: 30122, icon: "🇦🇪" },
    { label: "Singapore", value: 22406, icon: "🇸🇬" },
    { label: "Australia", value: 16008, icon: "🇦🇺" },
  ],
  devices: [
    { label: "iOS", value: 34980, icon: "📱" },
    { label: "Android", value: 29104, icon: "🤖" },
    { label: "macOS", value: 11220, icon: "💻" },
    { label: "Windows", value: 7106, icon: "🪟" },
    { label: "Linux", value: 1982, icon: "🐧" },
  ],
  browsers: [
    { label: "Chrome", value: 204880 },
    { label: "Safari", value: 118240 },
    { label: "Instagram in-app", value: 52104 },
    { label: "Edge", value: 21440 },
    { label: "Firefox", value: 12006 },
  ],
  referrers: [
    { label: "Instagram", value: 28440 },
    { label: "Direct / QR scan", value: 21808 },
    { label: "WhatsApp", value: 14902 },
    { label: "LinkedIn", value: 8330 },
    { label: "Email", value: 5122 },
    { label: "X", value: 3104 },
  ],
  tags: [
    { label: "campaign/spring", value: 128440 },
    { label: "product", value: 84210 },
    { label: "social", value: 61880 },
    { label: "docs", value: 38104 },
    { label: "careers", value: 22840 },
  ],
  topLinks: [
    { label: "snap.to/spring-sale", value: 84392 },
    { label: "snap.to/app", value: 61240 },
    { label: "go.acme.com/demo", value: 44118 },
    { label: "snap.to/pricing", value: 31006 },
    { label: "go.acme.com/webinar", value: 18402 },
  ],
};

export const DOMAINS: Domain[] = [
  {
    id: "dom_snapto",
    domain: "snap.to",
    status: "live",
    ssl: "active",
    sslRenewsAt: daysAgo(-77),
    links: 1022,
    rootRedirect: "https://acme.com",
    notFoundRedirect: "https://acme.com/404",
    dns: null,
  },
  {
    id: "dom_go",
    domain: "go.acme.com",
    status: "live",
    ssl: "active",
    sslRenewsAt: daysAgo(-98),
    links: 248,
    rootRedirect: "https://acme.com",
    notFoundRedirect: null,
    dns: null,
  },
  {
    id: "dom_link",
    domain: "acme.link",
    status: "verifying",
    ssl: "pending",
    sslRenewsAt: null,
    links: 14,
    rootRedirect: null,
    notFoundRedirect: null,
    dns: { type: "CNAME", name: "@", value: "edge.snapurl.dev", ttl: 3600 },
  },
];

export const MEMBERS: Member[] = [
  { id: "u1", name: "Dhananjay Thomble", email: "dhananjay@acme.com", role: "owner", status: "active", links: 412, lastActive: "Now", twoFactor: true, initials: "DT" },
  { id: "u2", name: "Priya Raman", email: "priya@acme.com", role: "admin", status: "active", links: 288, lastActive: "12 min ago", twoFactor: true, initials: "PR" },
  { id: "u3", name: "Arjun Kapoor", email: "arjun@acme.com", role: "editor", status: "active", links: 344, lastActive: "2 hours ago", twoFactor: false, initials: "AK" },
  { id: "u4", name: "Sara Mehta", email: "sara@acme.com", role: "editor", status: "active", links: 156, lastActive: "Yesterday", twoFactor: true, initials: "SM" },
  { id: "u5", name: "Ravi Nair", email: "ravi@acme.com", role: "viewer", status: "active", links: 0, lastActive: "3 days ago", twoFactor: true, initials: "RN" },
  { id: "u6", name: "maya@acme.com", email: "maya@acme.com", role: "editor", status: "invited", links: 0, lastActive: null, twoFactor: false, initials: "?" },
];

export const AUDIT: AuditEntry[] = [
  { id: "a1", at: "09:42", actor: "Priya", action: "changed the destination of snap.to/spring-sale" },
  { id: "a2", at: "09:31", actor: "Arjun", action: "created 42 links via CSV import" },
  { id: "a3", at: "08:57", actor: "Dhananjay", action: "invited maya@acme.com as Editor" },
  { id: "a4", at: "Yest.", actor: "Sara", action: "revoked API key snp_live_••••4c11" },
  { id: "a5", at: "Yest.", actor: "Priya", action: "added domain acme.link" },
];

export const API_KEYS: ApiKey[] = [
  { id: "k1", name: "Production server", maskedKey: "snp_live_••••8f2c", scopes: ["links:write", "analytics:read"], lastUsed: "2 min ago" },
  { id: "k2", name: "Zapier", maskedKey: "snp_live_••••1a49", scopes: ["links:write"], lastUsed: "4 hours ago" },
  { id: "k3", name: "Analytics export", maskedKey: "snp_live_••••93d0", scopes: ["analytics:read"], lastUsed: "Yesterday" },
];

export const WEBHOOKS: Webhook[] = [
  { id: "w1", endpoint: "api.acme.com/hooks/snapurl", events: ["link.clicked", "link.converted"], health: "healthy", detail: "100% · 24h" },
  { id: "w2", endpoint: "hooks.slack.com/services/…", events: ["link.created"], health: "retrying", detail: "3 retries" },
];

export const BIO_PAGES: BioPage[] = [
  {
    id: "bio_acme",
    domain: "snap.to",
    slug: "acme",
    status: "live",
    views: 42180,
    clickThrough: 31.4,
    profile: { name: "Acme", bio: "Tools for people who make things.", initials: "AC" },
    blocks: [
      { id: "b1", kind: "header", title: "Header", subtitle: "Logo, name and one-line bio", metric: null, locked: true },
      { id: "b2", kind: "link", title: "Shop the spring collection", subtitle: "→ snap.to/spring-sale", metric: "12.4k clicks", locked: false },
      { id: "b3", kind: "link", title: "Download the app", subtitle: "→ snap.to/app", metric: "8.1k clicks", locked: false },
      { id: "b4", kind: "embed", title: "Embed — product video", subtitle: "YouTube, plays inline", metric: "2.2k plays", locked: false },
      { id: "b5", kind: "email", title: "Email capture", subtitle: "Sends to Mailchimp", metric: "408 signups", locked: false },
      { id: "b6", kind: "social", title: "Social row", subtitle: "Instagram, LinkedIn, X, YouTube", metric: "1.9k clicks", locked: false },
    ],
  },
  { id: "bio_priya", domain: "snap.to", slug: "priya", status: "live", views: 8904, clickThrough: 44.1, profile: { name: "Priya Raman", bio: "Growth at Acme.", initials: "PR" }, blocks: [] },
  { id: "bio_events", domain: "go.acme.com", slug: "events", status: "live", views: 3442, clickThrough: 18.8, profile: { name: "Acme Events", bio: "Where to find us.", initials: "AE" }, blocks: [] },
  { id: "bio_hub", domain: "snap.to", slug: "spring-hub", status: "draft", views: 0, clickThrough: null, profile: { name: "Spring Hub", bio: "Everything spring.", initials: "SH" }, blocks: [] },
];

export const CONVERSIONS: ConversionsReport = {
  currency: "INR",
  totals: { clicks: 412908, leads: 28104, signups: 12440, paid: 1882, revenue: 3140000 },
  deltas: { clicks: 22.6, leads: 14.2, signups: -2.4, paid: 8.1, revenue: 11.9 },
  events: [
    { id: "e1", kind: "lead", name: "Demo requested", source: "POST /v1/track", count: 28104 },
    { id: "e2", kind: "signup", name: "Account created", source: "POST /v1/track", count: 12440 },
    { id: "e3", kind: "sale", name: "Subscription started", source: "Stripe webhook", count: 1882 },
    { id: "e4", kind: "custom", name: "Pricing page viewed", source: "snapurl.track('pricing')", count: 64220 },
  ],
  byLink: [
    { link: "snap.to/spring-sale", campaign: "Spring 2026", clicks: 84392, signups: 3118, cvr: 3.7, revenue: 1240000 },
    { link: "go.acme.com/demo", campaign: "Paid search", clicks: 44118, signups: 2884, cvr: 6.5, revenue: 980000 },
    { link: "snap.to/app", campaign: "Product", clicks: 61240, signups: 4102, cvr: 6.7, revenue: 510000 },
    { link: "snap.to/pricing", campaign: "Organic", clicks: 31006, signups: 1844, cvr: 5.9, revenue: 320000 },
    { link: "go.acme.com/webinar", campaign: "Q3 webinar", clicks: 18402, signups: 492, cvr: 2.7, revenue: 90000 },
  ],
  revenueSeries: spark(120),
};

const SESSION: AuthSession = {
  accessToken: "fixture.access.token",
  refreshToken: "fixture.refresh.token",
  user: { id: "u1", name: "Dhananjay Thomble", email: "dhananjay@acme.com", initials: "DT", role: "owner" },
};

function previewFor(slug: string): PublicLinkPreview {
  const link = LINKS.find((l) => l.slug === slug) ?? LINKS[0];
  return {
    shortUrl: `${link.domain}/${link.slug}`,
    destination: link.destination,
    createdAt: link.createdAt,
    createdBy: WORKSPACE.name,
    verifiedDomain: true,
    safeBrowsing: link.safeBrowsing.status,
    scannedAt: link.safeBrowsing.checkedAt,
    setsCookies: false,
    redirectType: link.redirectType,
  };
}

/* ============================================================
   Mutable stores.

   Fixtures are a working in-memory app rather than static JSON: a create,
   edit or delete has to be visible on the next render, or a flow built
   against them cannot be reviewed at all. Seeded from the constants above
   and reset by a page reload.

   When fixtures are on, a hook added without a case below throws rather
   than silently returning nothing — which is the failure this file exists
   to make loud.
   ============================================================ */
const linkStore: Link[] = [...LINKS];
const domainStore: Domain[] = [...DOMAINS];
const memberStore: Member[] = [...MEMBERS];
const apiKeyStore: ApiKey[] = [...API_KEYS];
const webhookStore: Webhook[] = [...WEBHOOKS];
const bioStore: BioPage[] = [...BIO_PAGES];
const auditStore: AuditEntry[] = [...AUDIT];

const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* Only the member actions write audit entries, because only the member actions
   write them in the real API today. Logging link or domain changes here would
   make the fixtures claim a capability the backend does not have yet. */
function recordAudit(action: string) {
  auditStore.unshift({ id: uid("aud"), at: new Date().toISOString(), actor: SESSION.user.name, action });
}

function findLink(idOrSlug: string) {
  return linkStore.find((l) => l.id === idOrSlug || l.slug === idOrSlug);
}

function removeById<T extends { id: string }>(store: T[], id: string) {
  const i = store.findIndex((row) => row.id === id);
  if (i >= 0) store.splice(i, 1);
}

function match(path: string) {
  const [clean] = path.split("?");
  return (pattern: RegExp) => pattern.exec(clean);
}

export async function fixtureRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  // A touch of latency so loading states are visible while reviewing.
  await new Promise((r) => setTimeout(r, 120));
  const m = match(path);
  const method = opts.method ?? "GET";

  let data: unknown;

  /* ---- auth ---- */
  if (m(/^\/auth\/(login|register)$/)) data = SESSION;
  else if (m(/^\/auth\/me$/)) data = SESSION.user;
  else if (m(/^\/auth\/logout$/)) data = undefined;
  else if (m(/^\/auth\/2fa\/setup$/)) {
    data = {
      otpauthUri: `otpauth://totp/SnapURL:${SESSION.user.email}?secret=JBSWY3DPEHPK3PXP&issuer=SnapURL`,
      secret: "JBSWY3DPEHPK3PXP",
    } satisfies TotpSetup;
  } else if (m(/^\/auth\/2fa\/enable$/)) {
    // Ten codes, shown once. Fixed strings so a reviewer can see the shape.
    data = {
      recoveryCodes: Array.from({ length: 10 }, (_, i) => `${1000 + i * 137}-${7300 - i * 91}`),
    } satisfies TotpRecoveryCodes;
  } else if (m(/^\/auth\/2fa\/verify$/)) data = SESSION;
  else if (m(/^\/auth\/2fa\/disable$/)) data = undefined;
  /* ---- workspace ---- */
  else if (m(/^\/workspaces\/current$/) && method === "PATCH") {
    Object.assign(WORKSPACE, opts.body as UpdateWorkspaceInput);
    data = WORKSPACE;
  } else if (m(/^\/workspaces\/current$/)) data = WORKSPACE;
  /* ---- links ---- */
  else if (m(/^\/links$/) && method === "POST") {
    const body = opts.body as { destination: string; domain: string; slug?: string };
    const link: Link = {
      ...LINKS[0],
      id: uid("lnk"),
      slug: body.slug || Math.random().toString(36).slice(2, 9),
      domain: body.domain,
      destination: body.destination,
      title: null,
      comment: null,
      tags: [],
      clicks: 0,
      uniqueClicks: 0,
      rules: [],
      sparkline: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      createdAt: new Date().toISOString(),
      createdBy: SESSION.user.name,
    };
    linkStore.unshift(link);
    data = link;
  } else if (m(/^\/links\/([^/]+)\/clone$/) && method === "POST") {
    const source = findLink(m(/^\/links\/([^/]+)\/clone$/)![1]);
    if (!source) throw new Error(`No fixture link ${path}`);
    const body = opts.body as { slug?: string; domain?: string; password?: string | null };
    /* Mirrors the server: everything that decides where a visitor lands is
       carried over, and everything that would be a lie on a new link is not —
       counters start at zero and a clone is never archived. */
    const link: Link = {
      ...source,
      id: uid("lnk"),
      slug: body.slug || Math.random().toString(36).slice(2, 9),
      domain: body.domain ?? source.domain,
      status: source.status === "archived" ? "active" : source.status,
      clicks: 0,
      uniqueClicks: 0,
      sparkline: Array(15).fill(0),
      // Omitting `password` inherits the source's protection.
      passwordProtected: body.password === undefined ? source.passwordProtected : body.password !== null,
      createdAt: new Date().toISOString(),
      createdBy: SESSION.user.name,
    };
    linkStore.unshift(link);
    data = link;
  } else if (m(/^\/links\/([^/]+)$/) && method === "PATCH") {
    const link = findLink(m(/^\/links\/([^/]+)$/)![1]);
    if (!link) throw new Error(`No fixture link ${path}`);
    const body = opts.body as UpdateLinkInput;
    // `archived` is a status transition rather than a stored column.
    const { archived, password, ...rest } = body;
    Object.assign(link, rest);
    if (archived !== undefined) link.status = archived ? "archived" : "active";
    if (password !== undefined) link.passwordProtected = password !== null;
    data = link;
  } else if (m(/^\/links\/([^/]+)$/) && method === "DELETE") {
    const link = findLink(m(/^\/links\/([^/]+)$/)![1]);
    if (link) removeById(linkStore, link.id);
    data = undefined;
  } else if (m(/^\/links\/([^/]+)$/)) {
    data = findLink(m(/^\/links\/([^/]+)$/)![1]) ?? LINKS[0];
  } else if (m(/^\/links$/)) {
    // Filtering is applied so the status tabs and the search box behave.
    const params = new URLSearchParams(path.split("?")[1] ?? "");
    const status = params.get("status");
    const search = params.get("search")?.toLowerCase();
    const tag = params.get("tag");
    const domain = params.get("domain");
    const folder = params.get("folder");
    let items = linkStore;
    if (status && status !== "all") items = items.filter((l) => l.status === status);
    if (tag) items = items.filter((l) => l.tags.includes(tag));
    if (domain) items = items.filter((l) => l.domain === domain);
    if (folder) items = items.filter((l) => l.folder === folder);
    if (search) {
      items = items.filter((l) =>
        [l.slug, l.destination, l.title ?? "", l.comment ?? ""].some((f) => f.toLowerCase().includes(search)),
      );
    }
    // One page, so nextCursor is always null — enough to exercise the field
    // without pretending the fixture set is big enough to paginate.
    data = { items, total: items.length, nextCursor: null };
  }
  /* ---- analytics and conversions ---- */
  else if (m(/^\/analytics/)) data = ANALYTICS;
  else if (m(/^\/conversions$/) && method === "POST") {
    const body = opts.body as RecordConversionInput;
    data = { id: uid("cnv"), recorded: Boolean(body.name) };
  } else if (m(/^\/conversions/)) data = CONVERSIONS;
  /* ---- domains ---- */
  else if (m(/^\/domains$/) && method === "POST") {
    const body = opts.body as { domain: string; rootRedirect?: string | null; notFoundRedirect?: string | null };
    const domain: Domain = {
      id: uid("dom"),
      domain: body.domain,
      // A new domain is never instantly live: it has to pass DNS first.
      status: "verifying",
      ssl: "pending",
      sslRenewsAt: null,
      links: 0,
      rootRedirect: body.rootRedirect ?? null,
      notFoundRedirect: body.notFoundRedirect ?? null,
      dns: { type: "CNAME", name: body.domain, value: "edge.snapurl.in", ttl: 3600 },
    };
    domainStore.unshift(domain);
    data = domain;
  } else if (m(/^\/domains\/([^/]+)\/verify$/)) {
    const domain = domainStore.find((d) => d.id === m(/^\/domains\/([^/]+)\/verify$/)![1]);
    if (!domain) throw new Error(`No fixture domain ${path}`);
    domain.status = "live";
    domain.ssl = "active";
    domain.sslRenewsAt = daysAgo(-90);
    data = domain;
  } else if (m(/^\/domains\/([^/]+)$/) && method === "DELETE") {
    removeById(domainStore, m(/^\/domains\/([^/]+)$/)![1]);
    data = undefined;
  } else if (m(/^\/domains$/)) data = domainStore;
  /* ---- members and audit ---- */
  else if (m(/^\/members$/) && method === "POST") {
    const body = opts.body as { email: string; role: MemberRole };
    const name = body.email.split("@")[0].replace(/[._-]+/g, " ");
    const member: Member = {
      id: uid("mem"),
      name,
      email: body.email,
      role: body.role,
      status: "invited",
      links: 0,
      lastActive: null,
      twoFactor: false,
      initials: name.slice(0, 2).toUpperCase(),
    };
    memberStore.push(member);
    recordAudit(`invited ${body.email} as ${body.role}`);
    data = member;
  } else if (m(/^\/members\/([^/]+)$/) && method === "PATCH") {
    const member = memberStore.find((x) => x.id === m(/^\/members\/([^/]+)$/)![1]);
    const role = (opts.body as { role: MemberRole }).role;
    if (member) {
      member.role = role;
      recordAudit(`changed ${member.email} to ${role}`);
    }
    data = undefined;
  } else if (m(/^\/members\/([^/]+)$/) && method === "DELETE") {
    const id = m(/^\/members\/([^/]+)$/)![1];
    const member = memberStore.find((x) => x.id === id);
    if (member) recordAudit(`removed ${member.email}`);
    removeById(memberStore, id);
    data = undefined;
  } else if (m(/^\/members$/)) data = memberStore;
  else if (m(/^\/audit$/)) data = auditStore;
  /* ---- api keys and webhooks ---- */
  else if (m(/^\/api-keys$/) && method === "POST") {
    const body = opts.body as { name: string; scopes: string[] };
    const secret = `sk_live_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
    const key: CreatedApiKey = {
      id: uid("key"),
      name: body.name,
      // The masked form is what every later read returns.
      maskedKey: `sk_live_••••${secret.slice(-4)}`,
      scopes: body.scopes,
      lastUsed: null,
      key: secret,
    };
    apiKeyStore.unshift({ id: key.id, name: key.name, maskedKey: key.maskedKey, scopes: key.scopes, lastUsed: null });
    data = key;
  } else if (m(/^\/api-keys\/([^/]+)$/) && method === "DELETE") {
    removeById(apiKeyStore, m(/^\/api-keys\/([^/]+)$/)![1]);
    data = undefined;
  } else if (m(/^\/api-keys$/)) data = apiKeyStore;
  else if (m(/^\/webhooks$/) && method === "POST") {
    const body = opts.body as { endpoint: string; events: string[] };
    const hook: CreatedWebhook = {
      id: uid("whk"),
      endpoint: body.endpoint,
      events: body.events,
      health: "healthy",
      detail: "No deliveries yet",
      secret: `whsec_${Math.random().toString(36).slice(2, 18)}`,
    };
    webhookStore.unshift({
      id: hook.id,
      endpoint: hook.endpoint,
      events: hook.events,
      health: hook.health,
      detail: hook.detail,
    });
    data = hook;
  } else if (m(/^\/webhooks\/([^/]+)$/) && method === "DELETE") {
    removeById(webhookStore, m(/^\/webhooks\/([^/]+)$/)![1]);
    data = undefined;
  } else if (m(/^\/webhooks$/)) data = webhookStore;
  /* ---- bio pages ---- */
  else if (m(/^\/bio-pages$/) && method === "PUT") {
    const body = opts.body as UpsertBioPageInput;
    // Keyed on (domain, slug), so save-existing and create are one call.
    const existing = bioStore.find((b) => b.domain === body.domain && b.slug === body.slug);
    const blocks = body.blocks.map((b, i) => ({
      id: b.id ?? uid(`blk${i}`),
      kind: b.kind,
      title: b.title,
      subtitle: b.subtitle ?? null,
      metric: b.metric ?? null,
      locked: b.locked,
    }));
    if (existing) {
      Object.assign(existing, { status: body.status, blocks });
      existing.profile = { ...existing.profile, name: body.profile.name, bio: body.profile.bio };
      data = existing;
    } else {
      const page: BioPage = {
        id: uid("bio"),
        domain: body.domain,
        slug: body.slug,
        status: body.status,
        blocks,
        views: 0,
        clickThrough: null,
        profile: {
          name: body.profile.name,
          bio: body.profile.bio,
          initials: body.profile.name.slice(0, 2).toUpperCase(),
        },
      };
      bioStore.unshift(page);
      data = page;
    }
  } else if (m(/^\/bio-pages\/([^/]+)$/) && method === "DELETE") {
    removeById(bioStore, m(/^\/bio-pages\/([^/]+)$/)![1]);
    data = undefined;
  } else if (m(/^\/bio-pages$/)) data = bioStore;
  /* ---- public ---- */
  else if (m(/^\/public\/links\/([^/]+)\/unlock$/)) {
    const password = (opts.body as { password?: string })?.password ?? "";
    // Any non-empty password unlocks. The point of the fixture is the flow,
    // not the check — the real verification is argon2 on the server.
    if (!password) throw new Error("That password is not right.");
    data = { unlockToken: `unlock.${Math.random().toString(36).slice(2)}`, expiresIn: 300 } satisfies UnlockLinkResult;
  } else if (m(/^\/public\/links\/([^/]+)\/preview$/)) {
    data = previewFor(m(/^\/public\/links\/([^/]+)\/preview$/)![1]);
  } else throw new Error(`No fixture for ${method} ${path}. Add one in src/lib/api/fixtures.ts.`);

  return schema.parse(data);
}
