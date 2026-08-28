"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHead } from "@/components/app-shell";
import { LinkRow } from "@/components/links/link-row";
import { Button, Card, EmptyState, ErrorState, Input, Skeleton, Tabs } from "@/components/ui";
import { useDomains, useExportLinks, useLinks } from "@/lib/api/hooks";
import type { ListLinksQuery } from "@snapurl/contract";
import { cn, full } from "@/lib/utils";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "scheduled", label: "Scheduled" },
  { value: "expiring", label: "Expiring" },
  { value: "expired", label: "Expired" },
  { value: "archived", label: "Archived" },
] as const;

const SELECT_CLASS =
  "inline-flex items-center px-[10px] py-[5px] bg-surface border border-line-2 rounded-full text-[12.5px] text-ink-2 hover:border-ink-3 hover:text-ink";

export default function LinksPage() {
  const [filter, setFilter] = useState<ListLinksQuery["status"]>("all");
  const exportLinks = useExportLinks();
  const [view, setView] = useState<"list" | "grid">("list");

  /* All four were implemented in LinksService.list and had no way in from the
     UI: the domain, tag and folder chips were decorative buttons and there was
     no search box at all. */
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [domain, setDomain] = useState("");
  const [tag, setTag] = useState("");
  const [folder, setFolder] = useState("");

  /* Cursor pages, kept as a stack. G4 chose a cursor over an offset because
     links are created continuously, so there is deliberately no "jump to page
     7" — a cursor cannot serve one. Back and forward is what it can do. */
  const [stack, setStack] = useState<string[]>([]);
  const cursor = stack[stack.length - 1];

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Any change to what is being asked for invalidates the page position.
  useEffect(() => {
    setStack([]);
  }, [filter, debounced, domain, tag, folder]);

  const query = useMemo(
    () => ({
      status: filter,
      ...(debounced ? { search: debounced } : {}),
      ...(domain ? { domain } : {}),
      ...(tag ? { tag } : {}),
      ...(folder ? { folder } : {}),
      ...(cursor ? { cursor } : {}),
    }),
    [filter, debounced, domain, tag, folder, cursor],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useLinks(query);
  const { data: domains } = useDomains();

  const links = data?.items ?? [];

  // No endpoint enumerates tags or folders, so the options come from what is
  // on the page. Enough to reach them; not a complete list of what exists.
  const tags = useMemo(() => [...new Set(links.flatMap((l) => l.tags))].sort(), [links]);
  const folders = useMemo(
    () => [...new Set(links.map((l) => l.folder).filter((f): f is string => Boolean(f)))].sort(),
    [links],
  );

  const filtered = Boolean(debounced || domain || tag || folder || filter !== "all");
  const page = stack.length + 1;

  return (
    <>
      <PageHead
        title="Links"
        sub={
          data
            ? `${full(data.total)} links across ${domains?.length ?? 0} domains · ${full(
                links.reduce((a, l) => a + l.clicks, 0),
              )} clicks on this page`
            : "Loading…"
        }
        actions={
          <>
            {/* Exports whatever the current filter shows, not always everything —
                otherwise "Export" after filtering to Expiring would quietly hand
                back the full workspace. */}
            <Button onClick={() => void exportLinks.run(filter)} disabled={exportLinks.exporting}>
              {exportLinks.exporting ? "Preparing…" : "Export CSV"}
            </Button>
          </>
        }
      />

      {exportLinks.error ? (
        <p className="text-[12.5px] text-bad mb-2" role="alert">
          {exportLinks.error}
        </p>
      ) : null}

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

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search back-halves and destinations"
          className="w-[260px] max-w-full"
          aria-label="Search links"
        />

        <select className={SELECT_CLASS} value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Filter by domain">
          <option value="">◈ Any domain</option>
          {(domains ?? []).map((d) => (
            <option key={d.id} value={d.domain}>
              {d.domain}
            </option>
          ))}
        </select>

        <select className={SELECT_CLASS} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
          <option value="">⌗ Any tag</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select className={SELECT_CLASS} value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Filter by folder">
          <option value="">▤ Any folder</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        {filtered ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setFilter("all"); setSearch(""); setDomain(""); setTag(""); setFolder(""); }}
          >
            Clear
          </Button>
        ) : null}

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
      ) : links.length === 0 ? (
        <Card>
          <EmptyState
            icon="⛓"
            title="No links here yet"
            body={
              filtered
                ? "Nothing matches those filters. Clear them to see everything again."
                : "Create your first link and it'll show up here with its click history."
            }
          />
        </Card>
      ) : (
        <>
          {/* The server applies every filter above, so the list is rendered as
              returned. Filtering again here would have hidden rows from a page
              that was already the correct page. */}
          <div className={cn(view === "grid" ? "grid grid-cols-1 xl:grid-cols-2 gap-2" : "flex flex-col gap-2")}>
            {links.map((link, i) => (
              <LinkRow key={link.id} link={link} defaultOpen={i === 0 && view === "list"} />
            ))}
          </div>

          {stack.length > 0 || data?.nextCursor ? (
            <div className="flex items-center gap-2 mt-3">
              <Button disabled={stack.length === 0 || isFetching} onClick={() => setStack((s) => s.slice(0, -1))}>
                ← Previous
              </Button>
              <span className="text-[12px] text-ink-3">
                Page {page} of {full(data?.total ?? 0)} links
              </span>
              <Button
                disabled={!data?.nextCursor || isFetching}
                onClick={() => data?.nextCursor && setStack((s) => [...s, data.nextCursor!])}
              >
                {isFetching ? "Loading…" : "Next →"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
