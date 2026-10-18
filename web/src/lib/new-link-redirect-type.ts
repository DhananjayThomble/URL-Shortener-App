import { RedirectType } from "@snapurl/contract";

/* #753 — which redirect type the New link drawer preselects.

   The workspace's "Default redirect type" setting says it "Applies to new
   links", so the drawer starts on it. Returns null when there is nothing to
   seed — the user already chose a type in this drawer (never overwrite a
   choice), or the workspace has not loaded / carries a value the contract
   does not know (a newer API) — in which case the drawer keeps whatever it
   already shows. */
export function seededRedirectType(workspaceDefault: unknown, userChose: boolean): RedirectType | null {
  if (userChose) return null;
  const parsed = RedirectType.safeParse(workspaceDefault);
  return parsed.success ? parsed.data : null;
}
