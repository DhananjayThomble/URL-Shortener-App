/* #783 — the audit trail's human copy, in one place.

   The API stores a machine key ("form.created") per audit row and renders it
   into a sentence before it leaves GET /audit; the team page shows that
   sentence after the actor's name. The renderer used to live as a switch in
   members.service.ts with no link to the writers, so every key added since
   (forms, abuse reports, flagging) fell through to `default: return action`
   and reached the page raw.

   AUDIT_ACTIONS is the closed set of keys the API writes. The label table is
   a `Record<AuditAction, ...>`, so adding a key without its sentence is a type
   error, and apps/api scans its own sources for every key it writes and fails
   if one is not listed here (apps/api/src/common/audit-actions.test.ts).

   Pure and framework-free so the web fixtures (and the team page's
   deploy-skew fallback) render exactly the same copy as the API. */

export const AUDIT_ACTIONS = [
  "member.invited",
  "member.invite_resent",
  "member.joined",
  "member.removed",
  "member.role_changed",
  "link.created",
  "link.updated",
  "link.deleted",
  "link.flagged",
  "abuse_report.reviewed",
  "form.created",
  "form.updated",
  "form.deleted",
  "domain.added",
  "domain.verified",
  "domain.updated",
  "domain.removed",
  "bio_page.created",
  "bio_page.updated",
  "bio_page.published",
  "bio_page.unpublished",
  "bio_page.deleted",
  "apikey.created",
  "apikey.revoked",
  "webhook.created",
  "webhook.removed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditMetadata = Record<string, unknown> | null | undefined;

const KNOWN = new Set<string>(AUDIT_ACTIONS);

export function isAuditAction(action: string): action is AuditAction {
  return KNOWN.has(action);
}

/** A metadata value as display text, or null when absent or not a non-empty
 *  string — a stored number/object/garbage never renders as "[object Object]"
 *  or "undefined". */
function text(metadata: AuditMetadata, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function form(metadata: AuditMetadata): string {
  const slug = text(metadata, "slug");
  return slug ? `the form /f/${slug}` : "a form";
}

function bioPage(metadata: AuditMetadata): string {
  const domain = text(metadata, "domain");
  const slug = text(metadata, "slug");
  if (domain && slug) return `the bio page ${domain}/${slug}`;
  if (slug) return `the bio page ${slug}`;
  return "a bio page";
}

const LABELS: Record<AuditAction, (metadata: AuditMetadata) => string> = {
  "member.invited": (m) => {
    const role = text(m, "role");
    return `Invited ${text(m, "email") ?? "a teammate"}${role ? ` as ${role}` : ""}`;
  },
  "member.invite_resent": (m) => `Resent the invitation to ${text(m, "email") ?? "a teammate"}`,
  "member.joined": (m) => `${text(m, "email") ?? "A teammate"} joined as ${text(m, "role") ?? "a member"}`,
  "member.removed": (m) => `Removed ${text(m, "email") ?? "a teammate"}`,
  "member.role_changed": (m) => {
    // Rows written before #783 carry no email; they still read as a sentence.
    const email = text(m, "email");
    const whose = email ? `${email}'s` : "a teammate's";
    const from = text(m, "from");
    const to = text(m, "to");
    if (from && to) return `Changed ${whose} role from ${from} to ${to}`;
    if (to) return `Changed ${whose} role to ${to}`;
    return `Changed ${whose} role`;
  },
  "link.created": (m) => `Created ${text(m, "slug") ?? "a link"}`,
  "link.updated": (m) => `Edited ${text(m, "slug") ?? "a link"}`,
  "link.deleted": (m) => `Deleted ${text(m, "slug") ?? "a link"}`,
  "link.flagged": (m) => `Flagged ${text(m, "slug") ?? "a link"} after an abuse report`,
  "abuse_report.reviewed": (m) => {
    const slug = text(m, "slug");
    return `Reviewed an abuse report${slug ? ` about ${slug}` : ""}`;
  },
  "form.created": (m) => `Created ${form(m)}`,
  "form.updated": (m) => `Edited ${form(m)}`,
  "form.deleted": (m) => `Deleted ${form(m)}`,
  "domain.added": (m) => `Connected ${text(m, "domain") ?? "a domain"}`,
  "domain.verified": (m) => `Verified ${text(m, "domain") ?? "a domain"}`,
  "domain.updated": (m) => `Changed redirects on ${text(m, "domain") ?? "a domain"}`,
  "domain.removed": (m) => `Disconnected ${text(m, "domain") ?? "a domain"}`,
  "bio_page.created": (m) =>
    text(m, "status") === "live" ? `Created and published ${bioPage(m)}` : `Created ${bioPage(m)} as a draft`,
  "bio_page.updated": (m) => `Edited ${bioPage(m)}`,
  "bio_page.published": (m) => `Published ${bioPage(m)}`,
  "bio_page.unpublished": (m) => `Unpublished ${bioPage(m)}`,
  "bio_page.deleted": (m) => `Deleted ${bioPage(m)}`,
  "apikey.created": () => "Created an API key",
  "apikey.revoked": () => "Revoked an API key",
  "webhook.created": () => "Added a webhook",
  "webhook.removed": () => "Removed a webhook",
};

/** Last resort for a key this build does not know (a row written by a newer
 *  API, or a hand-inserted one): "abuse_report.reviewed" -> "Abuse report
 *  reviewed". Never the raw key — dots and underscores are not copy. */
export function humaniseAuditKey(action: string): string {
  const words = action
    .split(/[._\s]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!words) return "Did something";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The sentence shown after the actor's name on the team page. */
export function describeAuditAction(action: string, metadata?: AuditMetadata): string {
  return isAuditAction(action) ? LABELS[action](metadata) : humaniseAuditKey(action);
}
