import postgres from "postgres";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";

/* Seeds a demo workspace with enough history that the dashboards look like a
   real account rather than an empty state.
     pnpm db:seed
   Sign in as demo@snapurl.local / demo-password-1234

   Idempotent: re-running wipes and rebuilds the demo workspace only. Anything
   else in the database is left alone. */

const URL = process.env.DATABASE_URL ?? "postgres://snapurl:snapurl@localhost:5433/snapurl";
const DEMO_EMAIL = "demo@snapurl.local";
const DEMO_PASSWORD = "demo-password-1234";
const DOMAIN = process.env.DEFAULT_DOMAIN ?? "localhost:3002";

/* Hashed at seed time with the same parameters the API uses. A hard-coded
   digest would be one silent typo away from a demo account nobody can sign
   into, and the whole point of the seed is that it works. */
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

const LINKS = [
  { slug: "spring-sale", dest: "https://acme.com/collections/spring-2026", tags: ["campaign/spring", "social"], folder: "campaign/spring", weight: 34 },
  { slug: "app", dest: "https://apps.apple.com/acme/download", tags: ["product"], folder: null, weight: 25 },
  { slug: "demo", dest: "https://calendly.com/acme/demo?team=sales", tags: ["sales"], folder: null, weight: 18 },
  { slug: "pricing", dest: "https://acme.com/pricing", tags: ["product", "docs"], folder: null, weight: 13 },
  { slug: "beta-invite", dest: "https://acme.com/beta/signup", tags: ["private"], folder: null, weight: 3, clickLimit: 500 },
  { slug: "webinar-q3", dest: "https://acme.com/events/q3-webinar", tags: ["campaign/q3"], folder: "campaign/q3", weight: 7, expired: true },
];

const COUNTRIES: Array<[string, number]> = [["IN", 42], ["US", 26], ["GB", 12], ["AE", 9], ["SG", 6], ["AU", 5]];
const BROWSERS: Array<[string, number]> = [["Chrome", 50], ["Safari", 29], ["Instagram in-app", 13], ["Edge", 5], ["Firefox", 3]];
const DEVICES: Array<[string, number]> = [["desktop", 44], ["ios", 31], ["android", 25]];

/** Deterministic so re-seeding produces the same charts. */
function pick<T extends string>(weighted: Array<[T, number]>, roll: number): T {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let point = roll % total;
  for (const [value, weight] of weighted) {
    if (point < weight) return value;
    point -= weight;
  }
  return weighted[0]![0];
}

async function main() {
  const sql = postgres(URL, { max: 1 });
  try {
    console.log("seeding demo workspace...");
    const passwordHash = await argon2.hash(DEMO_PASSWORD, ARGON_OPTIONS);

    await sql`delete from users where email = ${DEMO_EMAIL}`;
    await sql`delete from workspaces where slug = 'acme-growth'`;

    const [user] = await sql`
      insert into users (name, email, password_hash, email_verified_at, last_active_at)
      values ('Demo User', ${DEMO_EMAIL}, ${passwordHash}, now(), now())
      returning id`;

    const [workspace] = await sql`
      insert into workspaces (name, slug, plan, clicks_included, retention_years, currency)
      values ('Acme Growth', 'acme-growth', 'Growth', 1000000, 3, 'INR')
      returning id`;

    await sql`
      insert into domains (workspace_id, domain, is_system, status, ssl, verified_at)
      values (null, ${DOMAIN}, true, 'live', 'active', now())
      on conflict do nothing`;
    const [domain] = await sql`select id from domains where lower(domain) = ${DOMAIN.toLowerCase()}`;

    await sql`update workspaces set default_domain_id = ${domain!.id} where id = ${workspace!.id}`;
    await sql`
      insert into memberships (workspace_id, user_id, email, role, status, accepted_at)
      values (${workspace!.id}, ${user!.id}, ${DEMO_EMAIL}, 'owner', 'active', now())`;

    // A second, invited teammate so the team page is not a list of one.
    await sql`
      insert into memberships (workspace_id, email, role, status, invited_at)
      values (${workspace!.id}, 'teammate@snapurl.local', 'editor', 'invited', now() - interval '2 days')`;

    const linkIds: Array<{ id: string; weight: number }> = [];

    for (const link of LINKS) {
      const [row] = await sql`
        insert into links (
          workspace_id, domain_id, slug, destination, tags, folder, redirect_type,
          expires_at, click_limit, safe_browsing_status, safe_browsing_checked_at,
          created_by, created_at
        ) values (
          ${workspace!.id}, ${domain!.id}, ${link.slug}, ${link.dest},
          ${link.tags}, ${link.folder}, '302',
          ${link.expired ? new Date(Date.now() - 6 * 86_400_000) : null},
          ${link.clickLimit ?? null},
          'clean', now(), ${user!.id}, ${new Date(Date.now() - 90 * 86_400_000)}
        ) returning id`;
      linkIds.push({ id: row!.id, weight: link.weight });
    }

    /* The routing chain from the fixtures: India → the India store, iOS → the
       App Store, everyone else split 50/50. */
    const spring = linkIds[0]!.id;
    const chain: Array<[number, string | null, string | null, string, number | null]> = [
      [0, "IN", null, "https://acme.in/spring", null],
      [1, null, "ios", "https://apps.apple.com/acme", null],
      [2, null, null, "https://acme.com/spring-2026", 50],
      [3, null, null, "https://acme.com/spring-2026-b", 50],
    ];
    for (const [position, country, device, then, weight] of chain) {
      await sql`
        insert into routing_rules ("link_id", "position", "when_country", "when_device", "then", "weight")
        values (${spring}, ${position}, ${country}, ${device}, ${then}, ${weight})`;
    }

    console.log("  generating 90 days of rollups...");
    for (let daysAgo = 89; daysAgo >= 0; daysAgo--) {
      // A gentle upward trend with a weekly dip, so the charts have shape.
      const dayOfWeek = (daysAgo + 3) % 7;
      const weekendDip = dayOfWeek === 0 || dayOfWeek === 6 ? 0.62 : 1;
      const trend = 0.55 + (89 - daysAgo) / 120;

      for (const { id, weight } of linkIds) {
        const seed = (daysAgo * 31 + weight * 17) >>> 0;
        const clicks = Math.max(0, Math.round(weight * 42 * trend * weekendDip * (0.85 + ((seed % 30) / 100))));
        if (clicks === 0) continue;
        const uniques = Math.round(clicks * 0.7);
        const scans = Math.round(clicks * 0.15);

        await sql`
          insert into click_daily ("link_id", "workspace_id", "day", "clicks", "uniques", "scans", "blocked")
          values (${id}, ${workspace!.id}, (current_date - ${daysAgo}::int), ${clicks}, ${uniques}, ${scans}, ${seed % 40 === 0 ? 1 : 0})
          on conflict (link_id, day) do update set clicks = excluded.clicks, uniques = excluded.uniques, scans = excluded.scans`;

        for (const [dimension, table] of [["country", COUNTRIES], ["browser", BROWSERS], ["device", DEVICES]] as const) {
          for (const [value, share] of table) {
            const count = Math.round((clicks * share) / 100);
            if (count === 0) continue;
            await sql`
              insert into breakdown_daily ("workspace_id", "link_id", "day", "dimension", "value", "count")
              values (${workspace!.id}, ${id}, (current_date - ${daysAgo}::int), ${dimension}, ${value}, ${count})
              on conflict (workspace_id, coalesce(link_id, '00000000-0000-0000-0000-000000000000'::uuid), day, dimension, value)
              do update set "count" = excluded."count"`;
          }
        }
        void pick;
      }
    }

    await sql`
      insert into link_counters (link_id, clicks, unique_clicks)
      select link_id, sum(clicks)::int, sum(uniques)::int from click_daily group by link_id
      on conflict (link_id) do update set clicks = excluded.clicks, unique_clicks = excluded.unique_clicks`;

    console.log("  adding conversions...");
    for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
      for (const kind of ["lead", "signup", "sale"] as const) {
        const n = kind === "sale" ? 2 : kind === "signup" ? 5 : 9;
        for (let i = 0; i < n; i++) {
          await sql`
            insert into conversions (workspace_id, link_id, kind, name, source, value_minor, currency, occurred_at)
            values (
              ${workspace!.id}, ${linkIds[i % linkIds.length]!.id}, ${kind},
              ${kind === "sale" ? "Plan purchased" : kind === "signup" ? "Trial started" : "Newsletter signup"},
              'api', ${kind === "sale" ? 149900 : 0}, 'INR',
              ${new Date(Date.now() - daysAgo * 86_400_000)}
            )`;
        }
      }
    }

    const apiKey = `snap_live_${randomBytes(24).toString("base64url")}`;
    await sql`
      insert into api_keys (workspace_id, name, key_hash, key_prefix, key_last4, scopes, created_by)
      values (${workspace!.id}, 'Production', ${createHash("sha256").update(apiKey).digest("hex")},
              ${apiKey.slice(0, 15)}, ${apiKey.slice(-4)}, ${["links:read", "links:write", "analytics:read"]}, ${user!.id})`;

    const audit: Array<[string, Record<string, unknown>, number]> = [
      ["link.created", { slug: "spring-sale" }, 3 * 3_600_000],
      ["apikey.created", {}, 86_400_000],
      ["member.invited", { email: "teammate@snapurl.local" }, 2 * 86_400_000],
    ];
    for (const [action, metadata, agoMs] of audit) {
      await sql`
        insert into audit_log (workspace_id, actor_id, actor_label, action, metadata, at)
        values (${workspace!.id}, ${user!.id}, ${DEMO_EMAIL}, ${action}, ${sql.json(metadata)}, ${new Date(Date.now() - agoMs)})`;
    }

    const [{ total }] = await sql`select coalesce(sum(clicks),0)::int total from click_daily where workspace_id = ${workspace!.id}`;

    console.log("");
    console.log("  seeded.");
    console.log(`    sign in   ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    console.log(`    links     ${LINKS.length} on ${DOMAIN}`);
    console.log(`    clicks    ${Number(total).toLocaleString()} across 90 days`);
    console.log(`    api key   ${apiKey}`);
    console.log("");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
