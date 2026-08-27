import { z } from "zod";
import type {
  Analytics,
  ApiKey,
  AuditEntry,
  AuthSession,
  BioPage,
  ConversionsReport,
  Domain,
  Link,
  Member,
  PublicLinkPreview,
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

/** Mutations write here so the UI behaves like a real app during review. */
const created: Link[] = [];

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

  if (m(/^\/auth\/(login|register)$/)) data = SESSION;
  else if (m(/^\/auth\/me$/)) data = SESSION.user;
  else if (m(/^\/workspaces\/current$/)) data = WORKSPACE;
  else if (m(/^\/links$/) && method === "POST") {
    const body = opts.body as { destination: string; domain: string; slug?: string };
    const link: Link = {
      ...LINKS[0],
      id: `lnk_${Date.now()}`,
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
    created.unshift(link);
    data = link;
  } else if (m(/^\/links\/[^/]+$/) && method === "DELETE") data = undefined;
  else if (m(/^\/links\/([^/]+)$/)) {
    const slug = m(/^\/links\/([^/]+)$/)![1];
    data = [...created, ...LINKS].find((l) => l.id === slug || l.slug === slug) ?? LINKS[0];
  } else if (m(/^\/links$/)) data = { items: [...created, ...LINKS], total: created.length + LINKS.length };
  else if (m(/^\/analytics/)) data = ANALYTICS;
  else if (m(/^\/domains$/)) data = DOMAINS;
  else if (m(/^\/members$/)) data = MEMBERS;
  else if (m(/^\/audit$/)) data = AUDIT;
  else if (m(/^\/api-keys$/)) data = API_KEYS;
  else if (m(/^\/webhooks$/)) data = WEBHOOKS;
  else if (m(/^\/bio-pages$/)) data = BIO_PAGES;
  else if (m(/^\/conversions/)) data = CONVERSIONS;
  else if (m(/^\/public\/links\/([^/]+)\/preview$/)) data = previewFor(m(/^\/public\/links\/([^/]+)\/preview$/)![1]);
  else throw new Error(`No fixture for ${method} ${path}. Add one in src/lib/api/fixtures.ts.`);

  return schema.parse(data);
}
