import { UpdateDomainInput, type MemberRole } from "@snapurl/contract";

/** Whether the caller's role may change a domain's redirects. Mirrors the
 *  API gate on PATCH /domains/:id (@Roles("admin") = admin or owner); the API
 *  stays authoritative, this only stops offering a control that would 403
 *  (#711 review, Minor-5). Unknown role (still loading) = not offered. */
export function canEditDomainRedirects(role: MemberRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/* The /domains redirect editor's draft -> PATCH body step (#648).

   Pure so it can be unit-tested without a DOM. The rules are the contract's
   (UpdateDomainInput, which reuses the SSRF-guarded HttpUrl), not a second
   copy here: this only decides how a blank field is sent (null = clear) and
   which field each validation message belongs under. */

export type RedirectErrors = { rootRedirect?: string; notFoundRedirect?: string; form?: string };

export type RedirectDraftResult =
  | { ok: true; input: UpdateDomainInput }
  | { ok: false; errors: RedirectErrors };

export function parseRedirectDraft(root: string, notFound: string): RedirectDraftResult {
  const parsed = UpdateDomainInput.safeParse({
    rootRedirect: root.trim() === "" ? null : root.trim(),
    notFoundRedirect: notFound.trim() === "" ? null : notFound.trim(),
  });
  if (parsed.success) return { ok: true, input: parsed.data };

  const errors: RedirectErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (key === "rootRedirect" || key === "notFoundRedirect") errors[key] ??= issue.message;
    else errors.form ??= issue.message;
  }
  return { ok: false, errors };
}
