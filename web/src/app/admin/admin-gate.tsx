"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdminMe } from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/client";
import { loginRedirectFor } from "@/lib/safe-next";
import { AdminShell } from "./admin-shell";
import { NotAuthorised } from "./not-authorised";

/**
 * The gate for every /admin route.
 *
 * The decision is the SERVER's: it asks GET /admin/me, which the API answers
 * 200 only for a confirmed platform admin (verified allow-listed email + 2FA)
 * and 403 for anyone else. The client never inspects the token — it cannot, the
 * admin status is derived from the live user row behind the API. Three outcomes:
 *
 *   - 200  -> render the admin shell and the page. Admin content is mounted
 *             ONLY on this branch, so a non-admin never receives it.
 *   - 403  -> "Not authorised". The account is signed in but not an admin.
 *   - 401  -> not signed in (or the session expired and could not refresh);
 *             bounce to /login with ?next= so they land back here after.
 *
 * Any other error (API down) shows "Not authorised" rather than leaking admin
 * UI — failing closed, the same discipline as the API guard.
 */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: admin, isPending, isError, error } = useAdminMe();

  const status = error instanceof ApiError ? error.status : undefined;

  useEffect(() => {
    // Not signed in at all: send them to sign in, carrying where they wanted to
    // go so the gate re-runs after. A 403 is a different thing — they ARE signed
    // in, just not an admin — and stays on this page as "Not authorised".
    if (isError && status === 401 && typeof window !== "undefined") {
      router.replace(loginRedirectFor(window.location));
    }
  }, [isError, status, router]);

  if (isPending) return <Checking />;
  if (status === 401) return null; // redirecting to /login
  if (isError || !admin) return <NotAuthorised />;

  return <AdminShell admin={admin}>{children}</AdminShell>;
}

/** Shown only while the admin check is in flight. */
function Checking() {
  return (
    <div className="min-h-screen grid place-items-center" role="status" aria-live="polite">
      <span className="font-mono text-[12px] text-ink-3">Checking admin access…</span>
    </div>
  );
}
