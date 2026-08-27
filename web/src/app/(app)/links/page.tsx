"use client";

import { useState } from "react";
import { PageHead } from "@/components/app-shell";
import { LinkRow } from "@/components/links/link-row";
import { Button, Card, EmptyState, ErrorState, Skeleton, Tabs } from "@/components/ui";
import { useLinks } from "@/lib/api/hooks";
import { cn, full } from "@/lib/utils";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "expiring", label: "Expiring" },
  { value: "archived", label: "Archived" },
] as const;

export default function LinksPage() {
  const [filter, setFilter] = useState<string>("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const { data, isLoading, isError, error, refetch } = useLinks(filter);

  const links = data?.items ?? [];
  const visible = filter === "all" ? links : links.filter((l) => l.status === filter);

  return (
    <>
      <PageHead
        title="Links"
        sub={
          data
            ? `${full(data.total)} links across 3 domains · ${full(
                links.reduce((a, l) => a + l.clicks, 0),
              )} clicks in the last 30 days`
            : "Loading…"
        }
        actions={
          <>
            <Button>Export</Button>
            <Button>Bulk create</Button>
          </>
        }
      />

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "inline-flex items-center gap-[6px] px-[10px] py-[5px] border rounded-full text-[12.5px] transition-colors",
                filter === f.value
                  ? "bg-ink text-surface border-ink font-semibold"
                  : "bg-surface border-line-2 text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="w-px h-[22px] bg-line" />
        {["◈ Domain", "⌗ Tags", "▤ Folder"].map((l) => (
          <button
            key={l}
            className="inline-flex items-center gap-[6px] px-[10px] py-[5px] bg-surface border border-line-2 rounded-full text-[12.5px] text-ink-2 hover:border-ink-3 hover:text-ink"
          >
            {l}
          </button>
        ))}
        <div className="ml-auto">
          <Tabs
            value={view}
            onChange={setView}
            options={[
              { value: "list", label: "List" },
              { value: "grid", label: "Grid" },
            ]}
          />
        </div>
      </div>

      {isError ? (
        <Card>
          <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
        </Card>
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px]" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="⛓"
            title="No links here yet"
            body={
              filter === "all"
                ? "Create your first link and it'll show up here with its click history."
                : `Nothing matches the "${filter}" filter right now.`
            }
          />
        </Card>
      ) : (
        <div className={cn(view === "grid" ? "grid grid-cols-1 xl:grid-cols-2 gap-2" : "flex flex-col gap-2")}>
          {visible.map((link, i) => (
            <LinkRow key={link.id} link={link} defaultOpen={i === 0 && view === "list"} />
          ))}
        </div>
      )}
    </>
  );
}
