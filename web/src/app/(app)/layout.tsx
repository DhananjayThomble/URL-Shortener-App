"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar, Topbar } from "@/components/app-shell";
import { CreateLinkDrawer } from "@/components/links/create-link-drawer";
import { useBioPages, useDomains, useLinks, useMe, useMembers } from "@/lib/api/hooks";

/**
 * The gate for every authenticated route.
 *
 * Without this, an unauthenticated visit to /links mounted the whole shell and
 * fired five parallel requests that all 401'd, leaving the visitor looking at a
 * half-rendered dashboard full of errors instead of a sign-in page.
 *
 * The workspace queries live in AuthedShell rather than here on purpose: hooks
 * cannot be called conditionally, so the only way to stop them firing before we
 * know who the visitor is, is to not mount the component that owns them.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: me, isPending, isError } = useMe();

  useEffect(() => {
    // `replace`, not `push` — a signed-out visitor should not be able to press
    // Back into a dashboard that cannot load.
    if (isError) router.replace("/login");
  }, [isError, router]);

  if (isPending) return <Booting />;
  if (isError || !me) return null; // redirecting

  return <AuthedShell>{children}</AuthedShell>;
}

/** Shown only while the session check is in flight, so it should not flash. */
function Booting() {
  return (
    <div className="min-h-screen grid place-items-center" role="status" aria-live="polite">
      <span className="font-mono text-[12px] text-ink-3">Checking your session…</span>
    </div>
  );
}

function AuthedShell({ children }: { children: React.ReactNode }) {
  const [creating, setCreating] = useState(false);
  const { data: links } = useLinks();
  const { data: bio } = useBioPages();
  const { data: domains } = useDomains();
  const { data: members } = useMembers();

  return (
    <div className="flex min-h-screen">
      <Sidebar
        onCreate={() => setCreating(true)}
        counts={{
          links: links?.total,
          bio: bio?.length,
          domains: domains?.length,
          members: members?.length,
        }}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar onCreate={() => setCreating(true)} />
        <main className="flex-1 px-[14px] sm:px-[22px] pt-[26px] pb-[60px]">{children}</main>
      </div>
      <CreateLinkDrawer open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
