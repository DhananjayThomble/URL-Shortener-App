"use client";

import NextLink from "next/link";
import { useState } from "react";
import { Sparkline } from "@/components/charts";
import { Chip } from "@/components/ui";
import type { Link, LinkStatus } from "@/lib/api/types";
import { cn, compact, copy, faviconFor, formatDate, relativeDate } from "@/lib/utils";

const STATUS: Record<LinkStatus, { tone: "good" | "warn" | "bad" | "default"; label: (l: Link) => string }> = {
  active: { tone: "good", label: () => "Active" },
  scheduled: {
    tone: "warn",
    label: (l) => (l.activatesAt ? `Live ${formatDate(l.activatesAt)}` : "Scheduled"),
  },
  expiring: { tone: "warn", label: (l) => (l.clickLimit ? `${compact(l.clicks)} of ${compact(l.clickLimit)} clicks used` : "Expiring") },
  expired: { tone: "bad", label: (l) => (l.expiresAt ? `Expired ${formatDate(l.expiresAt)}` : "Expired") },
  archived: { tone: "default", label: () => "Archived" },
};

export function LinkRow({ link, defaultOpen = false }: { link: Link; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const status = STATUS[link.status];
  const url = `${link.domain}/${link.slug}`;

  async function onCopy() {
    const ok = await copy(`https://${url}`);
    setCopied(ok);
    setTimeout(() => setCopied(false), 1600);
  }

  const meta = [
    `${link.redirectType} ${link.redirectType === "301" ? "permanent" : "temporary"}`,
    /* A link that has not started yet is described by when it starts. Leading
       with "Never expires" on something that does not work yet reads as though
       it does. */
    link.status === "scheduled" && link.activatesAt
      ? `Goes live ${formatDate(link.activatesAt)}`
      : link.expiresAt
        ? `Expires ${formatDate(link.expiresAt)}`
        : link.clickLimit
          ? `Expires after ${compact(link.clickLimit)} clicks`
          : "Never expires",
    link.passwordProtected ? "Password protected" : null,
    link.deepLink ? "Deep linking on" : null,
    link.hideReferrer ? "Referrer hidden" : null,
    `Scanned ${relativeDate(link.safeBrowsing.checkedAt)}`,
  ].filter(Boolean) as string[];

  return (
    <article className="bg-surface border border-line rounded-[var(--radius)] shadow-[var(--shadow-1)] overflow-hidden transition-[border-color,box-shadow] hover:border-line-2 hover:shadow-[var(--shadow-2)] group">
      <div className="flex items-center gap-[14px] px-[15px] py-[calc(13px*var(--density))]">
        <span className="w-8 h-8 rounded-lg bg-surface-3 grid place-items-center text-[14px] shrink-0 border border-line">
          {faviconFor(link.destination)}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <NextLink href={`/links/${link.id}`} className="font-mono text-[14px] font-semibold tracking-[-0.01em] hover:underline">
              <span className="text-ink-3 font-normal">{link.domain}/</span>
              <span className="text-accent">{link.slug}</span>
            </NextLink>
            <button
              onClick={onCopy}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-ink-3 text-[12px] px-[6px] py-[2px] rounded-[4px] hover:bg-surface-3 hover:text-ink transition-opacity"
            >
              {copied ? "✓ copied" : "⧉ copy"}
            </button>
            <Chip tone={status.tone} dot>
              {status.label(link)}
            </Chip>
          </div>
          <div className="flex items-center gap-[6px] text-[12.5px] text-ink-3 mt-[3px] truncate">
            <span className="opacity-60">↳</span>
            {link.destination.replace(/^https?:\/\//, "")}
          </div>
        </div>

        <div className="hidden md:flex gap-[5px] items-center shrink-0">
          {link.tags.slice(0, 2).map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>

        <div className="hidden md:block w-[96px] shrink-0">
          <Sparkline values={link.sparkline} tone={link.status === "expired" ? "muted" : "accent"} />
        </div>

        <div className="text-right shrink-0 min-w-[74px] tnum">
          <b className="font-display text-[16px] font-bold block tracking-[-0.02em]">{compact(link.clicks)}</b>
          <span className="text-[10.5px] text-ink-3 font-mono tracking-[0.06em] uppercase">clicks</span>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Hide routing" : "Show routing"}
          className={cn(
            "text-ink-3 p-[5px] rounded-[5px] shrink-0 hover:bg-surface-3 hover:text-ink transition-transform",
            open && "rotate-180 text-accent",
          )}
        >
          ⌄
        </button>
      </div>

      {open ? (
        <div className="border-t border-line bg-surface-2 px-[15px] pt-[14px] pb-[15px]">
          <div className="font-mono text-[9.5px] tracking-[0.13em] uppercase text-ink-3 mb-[11px]">
            Routing chain — first match wins
          </div>
          <div className="flex items-stretch flex-wrap gap-y-2">
            {link.rules.length === 0 ? (
              <span className="text-[12px] text-ink-3">
                No rules — every visitor goes straight to the destination.
              </span>
            ) : (
              link.rules.map((rule, i) => {
                const isLast = i === link.rules.length - 1;
                const cond = rule.when.country
                  ? `If country is ${rule.when.country}`
                  : rule.when.device
                    ? `If device is ${rule.when.device}`
                    : "Everything else";
                return (
                  <div key={rule.id} className={cn("flex items-center", i > 0 && "ml-[26px] relative")}>
                    {i > 0 ? (
                      <span className="absolute -left-[20px] top-1/2 -translate-y-1/2 text-ink-3 text-[13px]">→</span>
                    ) : null}
                    <div
                      className={cn(
                        "flex items-center gap-[9px] px-3 py-2 rounded-[var(--radius-sm)] border",
                        isLast ? "border-dashed border-line bg-transparent" : "border-line bg-surface",
                      )}
                    >
                      <span className="text-[12px] text-ink-2">{cond}</span>
                      {rule.weight ? <Chip tone="accent">A/B {rule.weight}-{100 - rule.weight}</Chip> : null}
                      <span className="font-mono text-[11.5px] text-teal">{rule.then.replace(/^https?:\/\//, "")}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex gap-[18px] mt-3 flex-wrap text-[11.5px] text-ink-3">
            {meta.map((m) => (
              <span key={m}>
                <b className="text-ink-2 font-semibold">·</b> {m}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
