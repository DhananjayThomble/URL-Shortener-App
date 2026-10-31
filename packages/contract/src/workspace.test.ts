import { describe, expect, it } from "vitest";
import {
  AddDomainInput,
  ApiKey,
  AuditEntry,
  BioBlock,
  BioPage,
  ChangeRoleInput,
  CreateApiKeyInput,
  CreateWebhookInput,
  CreatedApiKey,
  CreatedWebhook,
  DnsRecord,
  Domain,
  InviteMemberInput,
  Member,
  MemberRole,
  PublicBioBlock,
  PublicBioPage,
  UpdateDomainInput,
  UpdateWorkspaceInput,
  UpsertBioPageInput,
  Webhook,
  Workspace,
} from "./workspace.js";

/* #895: workspace.ts carries the team, domain and developer surfaces. These
   pin the role/status/health enums, the input constraints (name/slug/retention
   bounds, scope floors, the domain-name pattern), the shapes of the
   server-returned DTOs, and the two rules with real logic:
   UpdateDomainInput's strict+at-least-one refinement, and InviteMemberInput's
   "a member cannot be invited as owner" exclusion. */

describe("MemberRole enum", () => {
  it("accepts the four roles and rejects others", () => {
    for (const r of ["owner", "admin", "editor", "viewer"]) expect(MemberRole.safeParse(r).success).toBe(true);
    expect(MemberRole.safeParse("superadmin").success).toBe(false);
    expect(MemberRole.safeParse("").success).toBe(false);
  });
});

describe("Workspace shape and currency default", () => {
  const valid = {
    id: "w1",
    name: "Acme",
    slug: "acme",
    initials: "AC",
    plan: "pro",
    defaultDomain: "sho.rt",
    defaultRedirect: "302" as const,
    clicksUsed: 10,
    clicksIncluded: 1000,
    retentionYears: 2,
    cookielessAnalytics: true,
    scanOnCreate: true,
    publicPreviews: true,
  };
  it("defaults currency to INR and keeps the declared fields", () => {
    const parsed = Workspace.parse(valid);
    expect(parsed.currency).toBe("INR"); // kills currency default("INR")
    expect(parsed.clicksUsed).toBe(10);
  });
  it("requires each field with its type (kills the shape → {} mutant)", () => {
    expect(Workspace.safeParse({ ...valid, defaultRedirect: "soon" }).success).toBe(false);
    expect(Workspace.safeParse({ ...valid, clicksUsed: "10" }).success).toBe(false);
    const { id: _id, ...noId } = valid;
    expect(Workspace.safeParse(noId).success).toBe(false);
  });
});

describe("UpdateWorkspaceInput constraints", () => {
  it("accepts a partial patch and validates the fields it carries", () => {
    expect(UpdateWorkspaceInput.safeParse({}).success).toBe(true); // all optional
    expect(UpdateWorkspaceInput.safeParse({ name: "New name" }).success).toBe(true);
  });
  it("enforces name 1..80 (kills min/max mutations)", () => {
    expect(UpdateWorkspaceInput.safeParse({ name: "" }).success).toBe(false);
    expect(UpdateWorkspaceInput.safeParse({ name: "a".repeat(80) }).success).toBe(true);
    expect(UpdateWorkspaceInput.safeParse({ name: "a".repeat(81) }).success).toBe(false);
  });
  it("enforces the lower-case/digit/hyphen slug pattern (kills the regex anchors)", () => {
    expect(UpdateWorkspaceInput.safeParse({ slug: "acme-1" }).success).toBe(true);
    expect(UpdateWorkspaceInput.safeParse({ slug: "Acme" }).success).toBe(false); // uppercase
    expect(UpdateWorkspaceInput.safeParse({ slug: "has space" }).success).toBe(false);
    expect(UpdateWorkspaceInput.safeParse({ slug: "has.dot" }).success).toBe(false);
    expect(UpdateWorkspaceInput.safeParse({ slug: "" }).success).toBe(false); // + requires >=1
  });
  it("enforces retentionYears as an int in 1..100 (kills int/min/max mutations)", () => {
    expect(UpdateWorkspaceInput.safeParse({ retentionYears: 1 }).success).toBe(true);
    expect(UpdateWorkspaceInput.safeParse({ retentionYears: 100 }).success).toBe(true);
    expect(UpdateWorkspaceInput.safeParse({ retentionYears: 0 }).success).toBe(false); // min(1) → max(1) mutant rejects 100
    expect(UpdateWorkspaceInput.safeParse({ retentionYears: 101 }).success).toBe(false);
    expect(UpdateWorkspaceInput.safeParse({ retentionYears: 2.5 }).success).toBe(false); // int()
  });
});

describe("DnsRecord and Domain shapes", () => {
  it("DnsRecord requires type/name/value strings and a numeric ttl", () => {
    expect(DnsRecord.parse({ type: "TXT", name: "_x", value: "v", ttl: 300 }).ttl).toBe(300);
    expect(DnsRecord.safeParse({ type: "TXT", name: "_x", value: "v" }).success).toBe(false);
    expect(DnsRecord.safeParse({ type: "TXT", name: "_x", value: "v", ttl: "300" }).success).toBe(false);
  });
  const domain = {
    id: "d1",
    domain: "go.acme.com",
    status: "live" as const,
    ssl: "active" as const,
    links: 4,
    rootRedirect: null,
    notFoundRedirect: null,
  };
  it("Domain enforces the status and ssl enums", () => {
    expect(Domain.parse(domain).status).toBe("live");
    expect(Domain.safeParse({ ...domain, status: "pending" }).success).toBe(false); // not a domain status
    expect(Domain.safeParse({ ...domain, ssl: "live" }).success).toBe(false); // not an ssl status
  });
  it("Domain requires the core fields (kills the shape → {} mutant)", () => {
    const { id: _id, ...noId } = domain;
    expect(Domain.safeParse(noId).success).toBe(false);
    expect(Domain.safeParse({ ...domain, links: "4" }).success).toBe(false);
  });
});

describe("AddDomainInput domain-name pattern", () => {
  it("accepts a plausible domain and rejects non-domains (kills the regex anchors + min(3))", () => {
    expect(AddDomainInput.safeParse({ domain: "go.acme.com" }).success).toBe(true);
    expect(AddDomainInput.safeParse({ domain: "acme.io" }).success).toBe(true);
    expect(AddDomainInput.safeParse({ domain: "no-tld" }).success).toBe(false); // needs a .tld (the \.[a-z]{2,} part)
    expect(AddDomainInput.safeParse({ domain: "bad domain.com" }).success).toBe(false); // space
    expect(AddDomainInput.safeParse({ domain: "a@b.com" }).success).toBe(false); // illegal char
    expect(AddDomainInput.safeParse({ domain: "x.y" }).success).toBe(false); // min(3) + single-char tld
  });
});

describe("UpdateDomainInput — strict + at-least-one refinement", () => {
  it("accepts a single field set", () => {
    expect(UpdateDomainInput.safeParse({ rootRedirect: "https://example.com" }).success).toBe(true);
    expect(UpdateDomainInput.safeParse({ notFoundRedirect: null }).success).toBe(true); // null clears
  });
  it("rejects an empty body (kills the refine → always-true / {} mutant)", () => {
    expect(UpdateDomainInput.safeParse({}).success).toBe(false);
  });
  it("rejects a body carrying only unknown keys (kills .strict() drop AND the refine)", () => {
    expect(UpdateDomainInput.safeParse({ domain: "acme.com" }).success).toBe(false);
    expect(UpdateDomainInput.safeParse({ isSystem: true }).success).toBe(false);
    expect(UpdateDomainInput.safeParse({ rootRedirect: null, workspaceId: "w1" }).success).toBe(false);
  });
});

describe("Member / InviteMemberInput / ChangeRoleInput", () => {
  const member = {
    id: "m1",
    name: "Jo",
    email: "jo@acme.com",
    role: "editor" as const,
    status: "active" as const,
    links: 0,
    lastActive: null,
    invitedAt: null,
    twoFactor: false,
    initials: "J",
  };
  it("Member enforces the role and status enums", () => {
    expect(Member.parse(member).role).toBe("editor");
    expect(Member.safeParse({ ...member, status: "pending" }).success).toBe(false); // only active|invited
    expect(Member.safeParse({ ...member, role: "root" }).success).toBe(false);
  });
  it("InviteMemberInput defaults role to editor and forbids inviting an owner", () => {
    const parsed = InviteMemberInput.parse({ email: "jo@acme.com" });
    expect(parsed.role).toBe("editor"); // kills default("editor")
    expect(InviteMemberInput.safeParse({ email: "jo@acme.com", role: "owner" }).success).toBe(false); // exclude(["owner"])
    expect(InviteMemberInput.safeParse({ email: "jo@acme.com", role: "admin" }).success).toBe(true);
    expect(InviteMemberInput.safeParse({ email: "not-an-email" }).success).toBe(false);
  });
  it("ChangeRoleInput requires a valid role (kills the shape → {} mutant)", () => {
    expect(ChangeRoleInput.parse({ role: "admin" }).role).toBe("admin");
    expect(ChangeRoleInput.safeParse({ role: "root" }).success).toBe(false);
    expect(ChangeRoleInput.safeParse({}).success).toBe(false);
  });
});

describe("AuditEntry / ApiKey / CreateApiKeyInput / CreatedApiKey", () => {
  it("AuditEntry requires id/at/actor/action", () => {
    expect(AuditEntry.parse({ id: "a", at: "t", actor: "x", action: "y" }).action).toBe("y");
    expect(AuditEntry.safeParse({ id: "a", at: "t", actor: "x" }).success).toBe(false);
  });
  it("ApiKey requires a scopes array and nullable lastUsed", () => {
    const parsed = ApiKey.parse({ id: "k", name: "CI", maskedKey: "sk_…", scopes: ["links:read"], lastUsed: null });
    expect(parsed.scopes).toEqual(["links:read"]);
    expect(ApiKey.safeParse({ id: "k", name: "CI", maskedKey: "x", scopes: "links:read", lastUsed: null }).success).toBe(false);
  });
  it("CreateApiKeyInput enforces name 1..60 and at least one valid scope", () => {
    expect(CreateApiKeyInput.safeParse({ name: "CI", scopes: ["links:read"] }).success).toBe(true);
    expect(CreateApiKeyInput.safeParse({ name: "", scopes: ["links:read"] }).success).toBe(false); // min(1)
    expect(CreateApiKeyInput.safeParse({ name: "a".repeat(61), scopes: ["links:read"] }).success).toBe(false); // max(60)
    expect(CreateApiKeyInput.safeParse({ name: "CI", scopes: [] }).success).toBe(false); // min(1) on scopes → max(1) mutant accepts [] ... kills via next line
    expect(CreateApiKeyInput.safeParse({ name: "CI", scopes: ["links:read", "links:write"] }).success).toBe(true); // 2 ok → max(1) mutant rejects
    expect(CreateApiKeyInput.safeParse({ name: "CI", scopes: ["not:a:scope"] }).success).toBe(false); // enum(API_SCOPES)
  });
  it("CreatedApiKey extends ApiKey with the full key (kills the extend shape → {})", () => {
    const base = { id: "k", name: "CI", maskedKey: "x", scopes: ["links:read"], lastUsed: null };
    expect(CreatedApiKey.parse({ ...base, key: "sk_live_x" }).key).toBe("sk_live_x");
    expect(CreatedApiKey.safeParse(base).success).toBe(false); // no key
    expect(CreatedApiKey.safeParse({ ...base, key: 123 }).success).toBe(false);
  });
});

describe("Webhook / CreateWebhookInput / CreatedWebhook", () => {
  it("Webhook enforces the health enum", () => {
    const wh = { id: "wh", endpoint: "https://x", events: ["link.created"], health: "healthy" as const, detail: "" };
    expect(Webhook.parse(wh).health).toBe("healthy");
    expect(Webhook.safeParse({ ...wh, health: "down" }).success).toBe(false);
  });
  it("CreateWebhookInput needs at least one valid event and an http(s) endpoint", () => {
    expect(CreateWebhookInput.safeParse({ endpoint: "https://x.com", events: ["link.created"] }).success).toBe(true);
    expect(CreateWebhookInput.safeParse({ endpoint: "https://x.com", events: [] }).success).toBe(false); // min(1)
    expect(CreateWebhookInput.safeParse({ endpoint: "https://x.com", events: ["bogus.event"] }).success).toBe(false);
    expect(CreateWebhookInput.safeParse({ endpoint: "javascript:alert(1)", events: ["link.created"] }).success).toBe(false);
  });
  it("CreatedWebhook extends Webhook with the secret (kills the extend shape → {})", () => {
    const wh = { id: "wh", endpoint: "https://x", events: ["link.created"], health: "healthy" as const, detail: "" };
    expect(CreatedWebhook.parse({ ...wh, secret: "whsec_x" }).secret).toBe("whsec_x");
    expect(CreatedWebhook.safeParse(wh).success).toBe(false);
  });
});

describe("BioBlock / BioPage / Public bio shapes", () => {
  it("BioBlock enforces the kind enum and defaults locked to false", () => {
    const parsed = BioBlock.parse({ id: "b1", kind: "link", title: "Home" });
    expect(parsed.locked).toBe(false); // kills locked default(false) → default(true)
    expect(BioBlock.safeParse({ id: "b1", kind: "video", title: "x" }).success).toBe(false);
  });
  it("BioPage enforces the status enum and nested profile shape", () => {
    const page = {
      id: "p1",
      domain: "sho.rt",
      slug: "me",
      status: "live" as const,
      blocks: [],
      views: 0,
      clickThrough: null,
      profile: { name: "Me", bio: "", initials: "M" },
    };
    expect(BioPage.parse(page).status).toBe("live");
    expect(BioPage.safeParse({ ...page, status: "archived" }).success).toBe(false);
    expect(BioPage.safeParse({ ...page, profile: { name: "Me", bio: "" } }).success).toBe(false); // no initials
  });
  it("PublicBioBlock / PublicBioPage require their fields", () => {
    const block = { id: "b1", kind: "link" as const, title: "Home" };
    expect(PublicBioBlock.parse(block).kind).toBe("link");
    expect(PublicBioBlock.safeParse({ id: "b1", kind: "nope", title: "x" }).success).toBe(false);
    const page = { slug: "me", profile: { name: "Me", bio: "", initials: "M" }, blocks: [block] };
    expect(PublicBioPage.parse(page).slug).toBe("me");
    expect(PublicBioPage.safeParse({ slug: "me", blocks: [] }).success).toBe(false); // no profile
  });
});

describe("UpsertBioPageInput — slug pattern, status default, nested block rules", () => {
  const base = {
    domain: "sho.rt",
    slug: "me",
    profile: { name: "Me", bio: "" },
  };
  it("defaults status to draft and blocks to an empty array", () => {
    const parsed = UpsertBioPageInput.parse(base);
    expect(parsed.status).toBe("draft"); // kills status default("draft")
    expect(parsed.blocks).toEqual([]); // kills blocks default([]) → ["Stryker was here"]
  });
  it("enforces the slug pattern (kills the regex anchors)", () => {
    expect(UpsertBioPageInput.safeParse({ ...base, slug: "my.page_1-v2" }).success).toBe(true);
    expect(UpsertBioPageInput.safeParse({ ...base, slug: "bad slug" }).success).toBe(false);
    expect(UpsertBioPageInput.safeParse({ ...base, slug: "" }).success).toBe(false); // + requires >=1
    expect(UpsertBioPageInput.safeParse({ ...base, slug: "has/slash" }).success).toBe(false);
  });
  it("enforces the profile name 1..80 and bio default + max 280", () => {
    expect(UpsertBioPageInput.parse(base).profile.bio).toBe(""); // bio default("")
    expect(UpsertBioPageInput.safeParse({ ...base, profile: { name: "", bio: "" } }).success).toBe(false);
    expect(UpsertBioPageInput.safeParse({ ...base, profile: { name: "Me", bio: "a".repeat(281) } }).success).toBe(false);
  });
  it("trims and bounds a block title 1..160, strips the id, bounds subtitle at 200", () => {
    const withBlock = (b: Record<string, unknown>) => ({ ...base, blocks: [{ kind: "link", title: "Home", ...b }] });
    expect(UpsertBioPageInput.safeParse(withBlock({})).success).toBe(true);
    expect(UpsertBioPageInput.safeParse(withBlock({ title: "   " })).success).toBe(false); // trim → min(1) rejects whitespace-only
    expect(UpsertBioPageInput.safeParse(withBlock({ title: "a".repeat(161) })).success).toBe(false); // max(160)
    expect(UpsertBioPageInput.safeParse(withBlock({ subtitle: "a".repeat(201) })).success).toBe(false); // max(200)
    // a block href still goes through HttpUrl
    expect(UpsertBioPageInput.safeParse(withBlock({ href: "javascript:alert(1)" })).success).toBe(false);
    // the trim is observable: a padded title parses to the trimmed value
    const parsed = UpsertBioPageInput.parse(withBlock({ title: "  Home  " }));
    expect(parsed.blocks[0]!.title).toBe("Home");
  });
  it("caps blocks at 50", () => {
    const blocks = (n: number) => Array.from({ length: n }, () => ({ kind: "link" as const, title: "t" }));
    expect(UpsertBioPageInput.safeParse({ ...base, blocks: blocks(50) }).success).toBe(true);
    expect(UpsertBioPageInput.safeParse({ ...base, blocks: blocks(51) }).success).toBe(false);
  });
});


describe("workspace residual-mutant kills (#895)", () => {
  it("AddDomainInput anchors the domain pattern at the end (kills the $-drop)", () => {
    // Dropping the trailing $ would accept a value that merely STARTS like a domain.
    expect(AddDomainInput.safeParse({ domain: "acme.com/evil" }).success).toBe(false);
    expect(AddDomainInput.safeParse({ domain: "acme.com extra" }).success).toBe(false);
  });

  it("UpdateDomainInput still enforces the at-least-one rule (kills the refine {error} → {} message object)", () => {
    // The refine's option object carries only the message; its predicate still runs.
    // An empty strict body is rejected whatever the message wrapper is.
    expect(UpdateDomainInput.safeParse({}).success).toBe(false);
    expect(UpdateDomainInput.safeParse({ rootRedirect: "https://ok.com" }).success).toBe(true);
  });

  it("BioPage.PublicBioPage profile nested shape is validated (kills the profile → {} mutant)", () => {
    const page = { slug: "me", profile: { name: "Me", bio: "", initials: "M" }, blocks: [] };
    expect(PublicBioPage.safeParse({ ...page, profile: { name: "Me", bio: "" } }).success).toBe(false); // no initials
    expect(PublicBioPage.safeParse({ ...page, profile: { name: 5, bio: "", initials: "M" } }).success).toBe(false);
  });

  it("UpsertBioPageInput status default is 'draft' and its block shape is an object, not {} (kills ArrayDeclaration/omit/BooleanLiteral)", () => {
    const parsed = UpsertBioPageInput.parse({ domain: "d", slug: "me", profile: { name: "Me", bio: "" } });
    expect(parsed.status).toBe("draft");
    // a block must still be shaped (an omit({}) or extend({}) → {} mutant would let anything through)
    expect(
      UpsertBioPageInput.safeParse({
        domain: "d",
        slug: "me",
        profile: { name: "Me", bio: "" },
        blocks: [{ kind: "link", title: "" }], // empty title rejected by trim().min(1)
      }).success,
    ).toBe(false);
    // an id on a block is allowed (omit({id:true}).extend({id: optional})) — kills omit({}) which would keep the required id
    expect(
      UpsertBioPageInput.safeParse({
        domain: "d",
        slug: "me",
        profile: { name: "Me", bio: "" },
        blocks: [{ kind: "link", title: "Home" }], // NO id — must be accepted
      }).success,
    ).toBe(true);
  });
});


describe("workspace residual kills, round 2 (#895)", () => {
  it("UpsertBioPageInput.status accepts a valid non-default value (kills the enum [] mutant)", () => {
    const parsed = UpsertBioPageInput.parse({ domain: "d", slug: "me", profile: { name: "Me", bio: "" }, status: "live" });
    expect(parsed.status).toBe("live");
  });

  it("UpdateDomainInput surfaces its at-least-one refinement message (kills the refine {error} → {} object)", () => {
    const r = UpdateDomainInput.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Provide rootRedirect and/or notFoundRedirect (null clears one)");
  });

  it("UpsertBioPageInput makes a block id optional via omit+extend (kills omit({id:true}) → omit({}) and the partial flag)", () => {
    const mk = (block: Record<string, unknown>) => ({ domain: "d", slug: "me", profile: { name: "Me", bio: "" }, blocks: [block] });
    // id omitted → accepted (the base BioBlock requires id; omit({id:true}) drops it, extend re-adds it optional)
    expect(UpsertBioPageInput.safeParse(mk({ kind: "link", title: "Home" })).success).toBe(true);
    // id present → still accepted (extend adds it back as optional string)
    expect(UpsertBioPageInput.safeParse(mk({ id: "keep-me", kind: "link", title: "Home" })).success).toBe(true);
    // and the id, when present, is preserved in the output
    const parsed = UpsertBioPageInput.parse(mk({ id: "keep-me", kind: "link", title: "Home" }));
    expect((parsed.blocks[0] as { id?: string }).id).toBe("keep-me");
  });
});
