"use client";

import { useState } from "react";
import { PageHead } from "@/components/app-shell";
import { Button, Card, CardBody, CardHeader, Chip, Skeleton, Table, TableWrap, Td, Th } from "@/components/ui";
import { useBioPages } from "@/lib/api/hooks";
import { full } from "@/lib/utils";

const BLOCK_ICON: Record<string, string> = {
  header: "🖼",
  link: "🔗",
  embed: "▶",
  email: "✉",
  social: "◈",
};

export default function BioPagesPage() {
  const { data, isLoading } = useBioPages();
  const pages = data ?? [];
  const [editing, setEditing] = useState(0);
  const page = pages[editing];

  return (
    <>
      <PageHead
        title="Bio pages"
        sub="One link that holds all the others. Every block is a real SnapURL link, so it shows up in your analytics like anything else."
        actions={
          <>
            <Button>Templates</Button>
            <Button variant="primary">＋ New page</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="Your pages" right={<Chip>{pages.length} of unlimited</Chip>} />
            {isLoading ? (
              <CardBody>
                <Skeleton className="h-[160px]" />
              </CardBody>
            ) : (
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Page</Th>
                      <Th>Blocks</Th>
                      <Th>Views (30d)</Th>
                      <Th>Click-through</Th>
                      <Th>Status</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map((p, i) => (
                      <tr key={p.id}>
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
                        <Td className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                            Edit
                          </Button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>

          {page ? (
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
                  <>
                    <Button size="sm">Theme</Button>
                    <Button size="sm" variant="primary">
                      Publish
                    </Button>
                  </>
                }
              />
              <CardBody className="flex flex-col gap-2">
                <div className="font-mono text-[9.5px] tracking-[0.13em] uppercase text-ink-3 flex items-center gap-2.5">
                  Blocks — drag to reorder
                  <span className="flex-1 h-px bg-line" />
                </div>
                {page.blocks.length === 0 ? (
                  <p className="text-[13px] text-ink-3 m-0 py-4">
                    This page has no blocks yet. Add one to get started.
                  </p>
                ) : (
                  page.blocks.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center gap-[11px] px-[13px] py-[11px] bg-surface-2 border border-line rounded-[var(--radius-sm)] hover:border-line-2"
                    >
                      <span className="text-ink-3 text-[13px] cursor-grab shrink-0">⠿</span>
                      <span className="w-7 h-7 rounded-[7px] bg-surface-3 grid place-items-center text-[13px] shrink-0">
                        {BLOCK_ICON[b.kind]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <b className="block text-[13px] font-semibold">{b.title}</b>
                        {b.subtitle ? (
                          <span className="block text-[11.5px] text-ink-3 truncate">{b.subtitle}</span>
                        ) : null}
                      </div>
                      {b.locked ? <Chip>always first</Chip> : b.metric ? <Chip tone="teal">{b.metric}</Chip> : null}
                    </div>
                  ))
                )}
                <button className="px-3 py-2 border border-dashed border-line-2 rounded-[var(--radius-sm)] text-ink-3 text-[12px] hover:border-accent hover:text-accent">
                  ＋ Add block
                </button>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <Card className="lg:sticky lg:top-[120px]">
          <CardHeader title="Live preview" />
          <CardBody className="grid place-items-center bg-surface-2">
            {page ? (
              <div className="flex flex-col items-center gap-[9px]">
                <div className="font-mono text-[10.5px] text-ink-3">
                  {page.domain}/{page.slug}
                </div>
                <div className="w-[212px] border-8 border-ink rounded-[26px] bg-surface px-[13px] pt-[18px] pb-[13px] flex flex-col items-center gap-2 shadow-[var(--shadow-2)]">
                  <div className="w-11 h-11 rounded-full bg-accent text-accent-ink grid place-items-center font-display font-extrabold text-[15px]">
                    {page.profile.initials}
                  </div>
                  <div className="font-display font-bold text-[14px]">{page.profile.name}</div>
                  <div className="text-[10.5px] text-ink-3 text-center leading-[1.45] mb-[3px]">{page.profile.bio}</div>
                  {page.blocks
                    .filter((b) => b.kind === "link")
                    .map((b, i) => (
                      <div
                        key={b.id}
                        className={
                          i === 0
                            ? "w-full p-2 rounded-lg text-[11px] text-center font-semibold bg-accent text-accent-ink border border-accent"
                            : "w-full p-2 rounded-lg text-[11px] text-center font-medium bg-surface-2 border border-line-2"
                        }
                      >
                        {b.title}
                      </div>
                    ))}
                  {page.blocks.some((b) => b.kind === "embed") ? (
                    <div className="w-full py-4 px-2 rounded-lg text-[10.5px] text-center bg-surface-3 text-ink-3">
                      ▶ Product video
                    </div>
                  ) : null}
                  {page.blocks.some((b) => b.kind === "social") ? (
                    <div className="flex gap-3 mt-[3px] text-ink-3 text-[12px]">
                      <span>◉</span>
                      <span>in</span>
                      <span>✕</span>
                      <span>▶</span>
                    </div>
                  ) : null}
                  <div className="text-[9px] text-ink-3 mt-1 opacity-70">Powered by SnapURL</div>
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
