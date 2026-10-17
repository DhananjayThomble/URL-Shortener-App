"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sidebar, Topbar } from "@/components/app-shell";
import { CreateLinkDrawer } from "@/components/links/create-link-drawer";
import { NEW_LINK_QUERY_PARAM } from "@/lib/hero-shorten";
import { useBioPages, useDomains, useLinks, useMe, useMembers, useWorkspaceChangeGuard } from "@/lib/api/hooks";

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
  // #699 — another tab (or a refresh fallback) moved the token to a different
  // workspace: drop everything cached for the old one.
  useWorkspaceChangeGuard();

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
  // #660 — the destination to seed the create drawer with when it is opened
  // from the marketing hero's `/links?new=<url>` deep link. Cleared whenever
  // the drawer closes so a later manual "New link" opens blank.
  const [createDestination, setCreateDestination] = useState<string | undefined>(undefined);
  const { data: links } = useLinks();
  const { data: bio } = useBioPages();
  const { data: domains } = useDomains();
  const { data: members } = useMembers();

  const openCreate = useCallback(() => {
    setCreateDestination(undefined);
    setCreating(true);
  }, []);

  const openCreateWith = useCallback((destination: string) => {
    setCreateDestination(destination);
    setCreating(true);
  }, []);

  const counts = {
    links: links?.total,
    bio: bio?.length,
    domains: domains?.length,
    members: members?.length,
  };

  return (
    <div className="flex min-h-screen">
      <Suspense fallback={null}>
        <NewLinkDeepLink onOpen={openCreateWith} />
      </Suspense>
      <Sidebar onCreate={openCreate} counts={counts} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar counts={counts} onCreate={openCreate} />
        <main className="flex-1 px-[14px] sm:px-[22px] pt-[26px] pb-[60px]">{children}</main>
      </div>
      <CreateLinkDrawer
        open={creating}
        initialDestination={createDestination}
        onClose={() => {
          setCreating(false);
          setCreateDestination(undefined);
        }}
      />
    </div>
  );
}

/**
 * Opens the create-link drawer prefilled with `?new=<url>` when a visitor
 * arrives from the marketing hero's Shorten box (#660), then drops the param
 * with router.replace so a refresh does not reopen the drawer. Only fires on
 * /links — the param is meaningless elsewhere, and the drawer is a /links
 * surface. Renders nothing; isolated so useSearchParams gets its own Suspense
 * boundary (mirrors ImportDeepLink on the links page).
 */
function NewLinkDeepLink({ onOpen }: { onOpen: (destination: string) => void }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const requested = params.get(NEW_LINK_QUERY_PARAM);
  useEffect(() => {
    if (requested === null || pathname !== "/links") return;
    onOpen(requested);
    router.replace("/links");
  }, [requested, pathname, onOpen, router]);
  return null;
}
