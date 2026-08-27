"use client";

import { useState } from "react";
import { Sidebar, Topbar } from "@/components/app-shell";
import { CreateLinkDrawer } from "@/components/links/create-link-drawer";
import { useBioPages, useDomains, useLinks, useMembers } from "@/lib/api/hooks";

export default function AppLayout({ children }: { children: React.ReactNode }) {
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
