"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHead } from "@/components/app-shell";
import { Button, Card, CardBody, CardHeader, Chip, Field, Input, Skeleton, Table, TableWrap, Td, Th } from "@/components/ui";
import { useBioPages, useDeleteBioPage, useDomains, useUpsertBioPage } from "@/lib/api/hooks";
import { UpsertBioPageInput, type BioBlock, type BioPage } from "@snapurl/contract";
import { full } from "@/lib/utils";

type Kind = BioBlock["kind"];

const BLOCK_ICON: Record<Kind, string> = {
  header: "🖼",
  link: "🔗",
  embed: "▶",
  email: "✉",
  social: "◈",
};

/* What "＋ Add block" offers. No header: the header is the profile itself,
   edited in the fields above the blocks, not a block a page can have twice. */
const ADDABLE: { kind: Exclude<Kind, "header">; label: string; title: string; placeholder: string }[] = [
  { kind: "link", label: "Link", title: "New link", placeholder: "https://example.com/page" },
  { kind: "embed", label: "Video", title: "Watch the video", placeholder: "https://www.youtube.com/watch?v=…" },
  { kind: "email", label: "Email signup", title: "Join the newsletter", placeholder: "https://example.com/newsletter" },
  { kind: "social", label: "Social profile", title: "Follow along", placeholder: "https://instagram.com/yourname" },
];

const TEMPLATES: Record<string, { label: string; blocks: { kind: Kind; title: string }[] }> = {
  blank: { label: "Blank", blocks: [] },
  creator: {
    label: "Creator",
    blocks: [
      { kind: "link", title: "My latest project" },
      { kind: "embed", title: "Watch my latest video" },
      { kind: "social", title: "Follow me" },
    ],
  },
  business: {
    label: "Business",
    blocks: [
      { kind: "link", title: "Shop now" },
      { kind: "link", title: "Book a call" },
      { kind: "email", title: "Get our newsletter" },
      { kind: "social", title: "Follow us" },
    ],
  },
};

const SELECT =
  "px-[11px] py-[7px] bg-surface border border-line-2 rounded-[var(--radius-sm)] text-[13px] w-full";

/* The editor works on a local draft and only talks to the API on Save or
   Publish. `key` is the draft's own handle (stable across reorders, present
   for blocks that do not exist server-side yet); `id` is the server's, and is
   only ever a value the server handed out — sending it back is what keeps a
   block's click count across a save. */
type DraftBlock = {
  key: string;
  id?: string;
  kind: Kind;
  title: string;
  subtitle: string;
  href: string;
  locked: boolean;
  metric: string | null;
};
type Draft = { name: string; bio: string; blocks: DraftBlock[] };

let nextKey = 0;
const newKey = () => `new-${++nextKey}`;

function fromPage(page: BioPage): Draft {
  return {
    name: page.profile.name,
    bio: page.profile.bio,
    blocks: page.blocks.map((b) => ({
      key: b.id,
      id: b.id,
      kind: b.kind,
      title: b.title,
      subtitle: b.subtitle ?? "",
      href: b.href ?? "",
      locked: b.locked,
      metric: b.metric ?? null,
    })),
  };
}

/* PUT /bio-pages replaces the whole page — profile, status and every block —
   so whatever is sent here IS the page afterwards. */
function toInput(page: BioPage, draft: Draft, status: BioPage["status"]): UpsertBioPageInput {
  return {
    domain: page.domain,
    slug: page.slug,
    status,
    profile: { name: draft.name.trim(), bio: draft.bio.trim() },
    blocks: draft.blocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      title: b.title.trim(),
      subtitle: b.subtitle.trim() || null,
      href: b.kind === "header" ? null : b.href.trim() || null,
      locked: b.locked,
    })),
  };
}

/** The contract is the validator; this only turns its first complaint into a
 *  sentence that says which block it is about. */
function problemWith(input: UpsertBioPageInput, draft: Draft): string | null {
  const parsed = UpsertBioPageInput.safeParse(input);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0]!;
  const [head, index, field] = issue.path;
  if (head === "blocks" && typeof index === "number") {
    const title = draft.blocks[index]?.title.trim() || `Block ${index + 1}`;
    const what = field === "href" ? "URL" : field === "title" ? "title" : String(field ?? "block");
    return `“${title}” — ${what}: ${issue.message}`;
  }
  if (head === "profile") return `Profile ${String(index ?? "")}: ${issue.message}`;
  return issue.message;
}

/** Locked blocks are pinned to the top; nothing may be placed above them. */
function firstMovable(blocks: DraftBlock[]) {
  const i = blocks.findIndex((b) => !b.locked);
  return i === -1 ? blocks.length : i;
}

function move(blocks: DraftBlock[], from: number, to: number): DraftBlock[] {
  const floor = firstMovable(blocks);
  if (blocks[from]?.locked) return blocks;
  const target = Math.max(floor, Math.min(blocks.length - 1, to));
  if (target === from) return blocks;
  const next = [...blocks];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item!);
  return next;
}

export default function BioPagesPage() {
  const { data, isLoading } = useBioPages();
  const { data: domains } = useDomains();
  const upsert = useUpsertBioPage();
  const remove = useDeleteBioPage();

  const pages = useMemo(() => data ?? [], [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const page = pages.find((p) => p.id === selectedId) ?? pages[0];

  const [creating, setCreating] = useState(false);
  const [newPage, setNewPage] = useState({ domain: "", slug: "", name: "", template: "blank" });
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftOf, setDraftOf] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // A fresh draft whenever the editor switches to a different page. Not on
  // every refetch: that would throw away what the person is typing.
  useEffect(() => {
    if (page && page.id !== draftOf) {
      setDraft(fromPage(page));
      setDraftOf(page.id);
      setOpen(null);
      setAdding(false);
    }
  }, [page, draftOf]);

  const editing = page && draft && draftOf === page.id ? draft : null;
  const dirty = Boolean(
    page && editing && JSON.stringify(toInput(page, editing, page.status)) !== JSON.stringify(toInput(page, fromPage(page), page.status)),
  );

  function select(id: string) {
    if (id === page?.id) return;
    if (dirty && !window.confirm("Discard your unsaved changes to this page?")) return;
    setSelectedId(id);
    setProblem(null);
    setSaved(false);
  }

  function update(fn: (d: Draft) => Draft) {
    setDraft((d) => (d ? fn(d) : d));
    setSaved(false);
    setProblem(null);
  }

  function updateBlock(key: string, patch: Partial<DraftBlock>) {
    update((d) => ({ ...d, blocks: d.blocks.map((b) => (b.key === key ? { ...b, ...patch } : b)) }));
  }

  function addBlock(kind: Exclude<Kind, "header">) {
    const spec = ADDABLE.find((a) => a.kind === kind)!;
    const key = newKey();
    update((d) => ({
      ...d,
      blocks: [...d.blocks, { key, kind, title: spec.title, subtitle: "", href: "", locked: false, metric: null }],
    }));
    setOpen(key);
    setAdding(false);
  }

  function removeBlock(key: string) {
    update((d) => ({ ...d, blocks: d.blocks.filter((b) => b.key !== key) }));
    if (open === key) setOpen(null);
  }

  function shift(key: string, by: number) {
    update((d) => {
      const i = d.blocks.findIndex((b) => b.key === key);
      return { ...d, blocks: move(d.blocks, i, i + by) };
    });
  }

  function dropOn(targetKey: string) {
    if (!dragging || dragging === targetKey) return;
    update((d) => {
      const from = d.blocks.findIndex((b) => b.key === dragging);
      const to = d.blocks.findIndex((b) => b.key === targetKey);
      return { ...d, blocks: move(d.blocks, from, to) };
    });
  }

  async function save(status: BioPage["status"]) {
    if (!page || !editing) return;
    const input = toInput(page, editing, status);
    const bad = problemWith(input, editing);
    if (bad) {
      setProblem(bad);
      return;
    }
    setProblem(null);
    try {
      const result = await upsert.mutateAsync(input);
      setDraft(fromPage(result));
      setDraftOf(result.id);
      setSaved(true);
    } catch (err) {
      setProblem((err as Error).message);
    }
  }

  async function create() {
    const domain = newPage.domain || domains?.[0]?.domain || "";
    if (!domain || !newPage.slug.trim() || !newPage.name.trim()) {
      setProblem("A page needs a domain, a back-half and a display name.");
      return;
    }
    try {
      const created = await upsert.mutateAsync({
        domain,
        slug: newPage.slug.trim(),
        status: "draft",
        profile: { name: newPage.name.trim(), bio: "" },
        blocks: (TEMPLATES[newPage.template] ?? TEMPLATES.blank!).blocks.map((b) => ({ ...b, locked: false })),
      });
      setNewPage({ domain: "", slug: "", name: "", template: "blank" });
      setCreating(false);
      setProblem(null);
      setSelectedId(created.id);
      setDraftOf(null);
    } catch (err) {
      setProblem((err as Error).message);
    }
  }

  async function destroy(id: string) {
    setProblem(null);
    try {
      await remove.mutateAsync(id);
      if (id === page?.id) {
        setSelectedId(null);
        setDraftOf(null);
      }
    } catch (err) {
      setProblem((err as Error).message);
    }
    setConfirming(null);
  }

  const movableFrom = editing ? firstMovable(editing.blocks) : 0;
  const previewBlocks = editing?.blocks.filter((b) => b.kind !== "header") ?? [];
  const firstLink = previewBlocks.find((b) => b.kind === "link")?.key;

  return (
    <>
      <PageHead
        title="Bio pages"
        sub="One link that holds all the others. Every block's clicks and every page view are counted — no cookies, no visitor tracking."
        actions={
          <Button variant="primary" onClick={() => { setCreating((v) => !v); setProblem(null); }}>
            {creating ? "Cancel" : "＋ New page"}
          </Button>
        }
      />

      {problem ? (
        <Card className="mb-3.5 border-bad" role="alert">
          <CardBody className="text-[13px] text-bad">{problem}</CardBody>
        </Card>
      ) : null}

      {creating ? (
        <Card className="mb-3.5">
          <CardHeader title="New bio page" />
          <CardBody className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Field label="Domain">
                <select
                  className={SELECT}
                  value={newPage.domain || domains?.[0]?.domain || ""}
                  onChange={(e) => setNewPage((d) => ({ ...d, domain: e.target.value }))}
                >
                  {(domains ?? []).map((d) => (
                    <option key={d.id} value={d.domain}>
                      {d.domain}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Back-half">
                <Input
                  value={newPage.slug}
                  placeholder="yourname"
                  className="font-mono text-[12.5px]"
                  onChange={(e) => { setNewPage((d) => ({ ...d, slug: e.target.value })); setProblem(null); }}
                />
              </Field>
              <Field label="Display name">
                <Input
                  value={newPage.name}
                  placeholder="Acme Growth"
                  onChange={(e) => { setNewPage((d) => ({ ...d, name: e.target.value })); setProblem(null); }}
                />
              </Field>
              <Field label="Start from">
                <select
                  className={SELECT}
                  value={newPage.template}
                  onChange={(e) => setNewPage((d) => ({ ...d, template: e.target.value }))}
                >
                  {Object.entries(TEMPLATES).map(([value, t]) => (
                    <option key={value} value={value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={create} disabled={upsert.isPending}>
                {upsert.isPending ? "Creating…" : "Create as draft"}
              </Button>
              <Button aria-label="Cancel creating a bio page" onClick={() => { setCreating(false); setProblem(null); }}>Cancel</Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="Your pages" right={<Chip>{pages.length} of unlimited</Chip>} />
            {isLoading ? (
              <CardBody>
                <Skeleton className="h-[160px]" />
              </CardBody>
            ) : (
              <TableWrap label="Your pages">
                <Table>
                  <thead>
                    <tr>
                      <Th>Page</Th>
                      <Th>Blocks</Th>
                      <Th>Views</Th>
                      <Th>Click-through</Th>
                      <Th>Status</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map((p) => (
                      <tr key={p.id} aria-current={p.id === page?.id ? "true" : undefined}>
                        <Td className="text-ink font-medium font-mono">
                          {p.domain}/{p.slug}
                        </Td>
                        <Td className="tnum">{p.blocks.length}</Td>
                        <Td className="tnum">{full(p.views)}</Td>
                        <Td className="tnum">{p.clickThrough != null ? `${p.clickThrough}%` : "—"}</Td>
                        <Td>
                          <Chip tone={p.status === "live" ? "good" : "warn"} dot>
                            {p.status === "live" ? "Live" : "Draft"}
                          </Chip>
                        </Td>
                        <Td className="text-right whitespace-nowrap">
                          {confirming === p.id ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                                Keep
                              </Button>
                              <Button size="sm" variant="danger" onClick={() => destroy(p.id)} disabled={remove.isPending}>
                                Delete
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => select(p.id)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setConfirming(p.id); setProblem(null); }}>
                                Delete
                              </Button>
                            </>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>

          {page && editing ? (
            <Card>
              <CardHeader
                title={
                  <>
                    Editing{" "}
                    <span className="font-mono text-accent">
                      {page.domain}/{page.slug}
                    </span>
                  </>
                }
                right={
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {page.status === "live" ? (
                      <a
                        href={`/b/${encodeURIComponent(page.slug)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] text-accent hover:underline"
                      >
                        Open page ↗
                      </a>
                    ) : null}
                    {dirty ? (
                      <>
                        <Button size="sm" variant="ghost" disabled={upsert.isPending} onClick={() => { setDraft(fromPage(page)); setProblem(null); setOpen(null); }}>
                          Discard
                        </Button>
                        <Button size="sm" disabled={upsert.isPending} onClick={() => save(page.status)}>
                          {upsert.isPending ? "Saving…" : "Save changes"}
                        </Button>
                      </>
                    ) : saved ? (
                      <span className="text-[12px] text-ink-3" role="status">Saved</span>
                    ) : null}
                    <Button
                      size="sm"
                      variant={page.status === "live" ? "default" : "primary"}
                      disabled={upsert.isPending}
                      onClick={() => save(page.status === "live" ? "draft" : "live")}
                    >
                      {page.status === "live" ? "Unpublish" : "Publish"}
                    </Button>
                  </div>
                }
              />
              <CardBody className="flex flex-col gap-2">
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 mb-2">
                  <Field label="Profile name">
                    <Input value={editing.name} maxLength={80} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} />
                  </Field>
                  <Field label="Profile bio" help={`${editing.bio.length}/280`}>
                    <Input
                      value={editing.bio}
                      maxLength={280}
                      placeholder="One line about you"
                      onChange={(e) => update((d) => ({ ...d, bio: e.target.value }))}
                    />
                  </Field>
                </div>

                <div className="font-mono text-[9.5px] tracking-[0.13em] uppercase text-ink-3 flex items-center gap-2.5">
                  Blocks — drag to reorder
                  <span className="flex-1 h-px bg-line" />
                </div>
                {editing.blocks.length === 0 ? (
                  <p className="text-[13px] text-ink-3 m-0 py-4">
                    This page has no blocks yet. Add one to get started.
                  </p>
                ) : (
                  <ol className="list-none m-0 p-0 flex flex-col gap-2" aria-label="Blocks">
                    {editing.blocks.map((b, i) => {
                      const spec = ADDABLE.find((a) => a.kind === b.kind);
                      const expanded = open === b.key;
                      return (
                        <li
                          key={b.key}
                          data-testid="bio-block"
                          draggable={!b.locked}
                          onDragStart={(e) => {
                            if (b.locked) return;
                            setDragging(b.key);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", b.key);
                          }}
                          onDragOver={(e) => {
                            if (!dragging || b.locked) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (over !== b.key) setOver(b.key);
                          }}
                          onDragLeave={() => setOver((o) => (o === b.key ? null : o))}
                          onDrop={(e) => {
                            e.preventDefault();
                            dropOn(b.key);
                            setDragging(null);
                            setOver(null);
                          }}
                          onDragEnd={() => { setDragging(null); setOver(null); }}
                          className={
                            "bg-surface-2 border rounded-[var(--radius-sm)] " +
                            (over === b.key && dragging !== b.key ? "border-accent" : "border-line hover:border-line-2") +
                            (dragging === b.key ? " opacity-60" : "")
                          }
                        >
                          <div className="flex items-center gap-[11px] px-[13px] py-[11px]">
                            <span
                              aria-hidden="true"
                              className={"text-ink-3 text-[13px] shrink-0 " + (b.locked ? "cursor-not-allowed" : "cursor-grab")}
                            >
                              ⠿
                            </span>
                            <span className="w-7 h-7 rounded-[7px] bg-surface-3 grid place-items-center text-[13px] shrink-0">
                              {BLOCK_ICON[b.kind]}
                            </span>
                            <div className="flex-1 min-w-0">
                              <b className="block text-[13px] font-semibold truncate">{b.title || "Untitled block"}</b>
                              {b.kind !== "header" && b.href ? (
                                <span className="block text-[11.5px] text-ink-3 truncate font-mono">{b.href}</span>
                              ) : b.subtitle ? (
                                <span className="block text-[11.5px] text-ink-3 truncate">{b.subtitle}</span>
                              ) : b.kind !== "header" ? (
                                <span className="block text-[11.5px] text-ink-3 italic truncate">No URL yet — not clickable</span>
                              ) : null}
                            </div>
                            {b.locked ? <Chip>always first</Chip> : b.metric ? <Chip tone="teal">{b.metric}</Chip> : null}
                            {!b.locked ? (
                              <div className="flex items-center shrink-0">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Move “${b.title}” up`}
                                  disabled={i <= movableFrom}
                                  onClick={() => shift(b.key, -1)}
                                >
                                  ↑
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Move “${b.title}” down`}
                                  disabled={i === editing.blocks.length - 1}
                                  onClick={() => shift(b.key, 1)}
                                >
                                  ↓
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-expanded={expanded}
                                  aria-label={`${expanded ? "Close" : "Edit"} block “${b.title}”`}
                                  onClick={() => setOpen(expanded ? null : b.key)}
                                >
                                  {expanded ? "Done" : "Edit"}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                          {expanded ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-[13px] pb-[13px]">
                              <Field label="Title">
                                <Input
                                  value={b.title}
                                  maxLength={160}
                                  onChange={(e) => updateBlock(b.key, { title: e.target.value })}
                                />
                              </Field>
                              <Field label="URL">
                                <Input
                                  value={b.href}
                                  type="url"
                                  inputMode="url"
                                  className="font-mono text-[12.5px]"
                                  placeholder={spec?.placeholder ?? "https://"}
                                  onChange={(e) => updateBlock(b.key, { href: e.target.value })}
                                />
                              </Field>
                              <Field label="Subtitle (optional)">
                                <Input
                                  value={b.subtitle}
                                  maxLength={200}
                                  onChange={(e) => updateBlock(b.key, { subtitle: e.target.value })}
                                />
                              </Field>
                              <div className="flex items-end justify-end">
                                <Button size="sm" variant="danger" onClick={() => removeBlock(b.key)}>
                                  Remove block
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                )}
                {adding ? (
                  <div className="flex flex-wrap gap-2 items-center p-2 border border-dashed border-line-2 rounded-[var(--radius-sm)]">
                    <span className="text-[12px] text-ink-3 mr-1">Add a</span>
                    {ADDABLE.map((a) => (
                      <Button key={a.kind} size="sm" onClick={() => addBlock(a.kind)}>
                        {BLOCK_ICON[a.kind]} {a.label}
                      </Button>
                    ))}
                    <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    disabled={editing.blocks.length >= 50}
                    className="px-3 py-2 border border-dashed border-line-2 rounded-[var(--radius-sm)] text-ink-3 text-[12px] hover:border-accent hover:text-accent disabled:opacity-60"
                  >
                    ＋ Add block
                  </button>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <Card className="lg:sticky lg:top-[120px]">
          <CardHeader title="Live preview" />
          <CardBody className="grid place-items-center bg-surface-2">
            {page && editing ? (
              <div className="flex flex-col items-center gap-[9px]">
                <div className="font-mono text-[10.5px] text-ink-3">
                  {page.domain}/{page.slug}
                </div>
                <div className="w-[212px] border-8 border-ink rounded-[26px] bg-surface px-[13px] pt-[18px] pb-[13px] flex flex-col items-center gap-2 shadow-[var(--shadow-2)]">
                  <div className="w-11 h-11 rounded-full bg-accent text-accent-ink grid place-items-center font-display font-extrabold text-[15px]">
                    {initials(editing.name)}
                  </div>
                  <div className="font-display font-bold text-[14px] text-center break-words max-w-full">{editing.name}</div>
                  {editing.bio ? (
                    <div className="text-[10.5px] text-ink-3 text-center leading-[1.45] mb-[3px] break-words max-w-full">{editing.bio}</div>
                  ) : null}
                  {previewBlocks.map((b) => (
                    <div
                      key={b.key}
                      className={
                        b.key === firstLink
                          ? "w-full p-2 rounded-lg text-[11px] text-center font-semibold bg-accent text-accent-ink border border-accent truncate"
                          : "w-full p-2 rounded-lg text-[11px] text-center font-medium bg-surface-2 border border-line-2 truncate"
                      }
                    >
                      {b.kind === "link" ? "" : `${BLOCK_ICON[b.kind]} `}
                      {b.title}
                    </div>
                  ))}
                  {/* No opacity utility here: opacity-70 composited --ink-3 (5.16:1 on its
                      own against --ground) down to an effective #87909a — 2.85:1, failing
                      WCAG AA SC 1.4.3. --ink-3 at full opacity keeps it the dimmest ink
                      token while staying compliant. See #497. */}
                  <div className="text-[9px] text-ink-3 mt-1">Powered by SnapURL</div>
                </div>
              </div>
            ) : (
              <Skeleton className="w-[212px] h-[300px]" />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

/** Same rule as the API's initialsOf, so the preview matches what is saved. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
