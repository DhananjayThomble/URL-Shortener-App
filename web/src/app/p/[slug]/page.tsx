"use client";

import { useParams } from "next/navigation";
import { Button, Chip, ErrorState, Skeleton } from "@/components/ui";
import { useLinkPreview } from "@/lib/api/hooks";
import { formatDate, relativeDate } from "@/lib/utils";

/* The public trust page. Anyone can reach it by adding "+" to a short link;
   the redirect service rewrites that to /p/<slug>. No auth, no cookies. */
export default function LinkPreviewPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, isError, error, refetch } = useLinkPreview(slug);

  return (
    <div className="max-w-[560px] mx-auto px-6 pt-[60px] pb-20">
      <div className="text-center mb-[26px]">
        <div className="inline-flex items-center gap-[9px]">
          <span className="w-[27px] h-[27px] rounded-[7px] bg-accent text-accent-ink grid place-items-center font-display font-extrabold text-[15px]">
            S
          </span>
          <b className="font-display text-[16px] font-bold tracking-[-0.02em]">SnapURL</b>
        </div>
      </div>

      <div className="bg-surface border border-line rounded-[14px] shadow-[var(--shadow-2)] overflow-hidden">
        {isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <div className="p-6 flex flex-col gap-3">
            <Skeleton className="h-[46px] w-[46px] rounded-[13px] mx-auto" />
            <Skeleton className="h-5 w-2/3 mx-auto" />
            <Skeleton className="h-[70px]" />
            <Skeleton className="h-[180px]" />
          </div>
        ) : (
          <>
            <div className="p-6 border-b border-line text-center">
              <div
                className={`w-[46px] h-[46px] rounded-[13px] grid place-items-center text-[21px] mx-auto mb-3.5 ${
                  data.safeBrowsing === "clean" ? "bg-wash-good text-good" : "bg-wash-warn text-amber"
                }`}
              >
                🛡
              </div>
              <h2 className="text-[19px] font-bold">
                {data.safeBrowsing === "clean" ? "This link is safe to open" : "We couldn't fully verify this link"}
              </h2>
            </div>

            <div className="px-6 py-[18px] bg-surface-2 border-b border-line">
              <div className="font-mono text-[9.5px] tracking-[0.13em] uppercase text-ink-3 mb-[7px]">Where it goes</div>
              <div className="font-mono text-[13.5px] break-all text-ink leading-[1.6]">{data.destination}</div>
            </div>

            <div className="px-6">
              {(
                [
                  ["Short link", <span key="s" className="font-mono">{data.shortUrl}</span>],
                  ["Created", `${formatDate(data.createdAt)} · ${relativeDate(data.createdAt)}`],
                  [
                    "Created by",
                    <span key="c" className="flex items-center gap-2">
                      {data.createdBy}
                      {data.verifiedDomain ? <Chip tone="good">Verified domain</Chip> : null}
                    </span>,
                  ],
                  [
                    "Safety scan",
                    <Chip key="sb" tone={data.safeBrowsing === "clean" ? "good" : "warn"} dot>
                      {data.safeBrowsing === "clean" ? "No threats found" : "Unverified"}
                    </Chip>,
                  ],
                  [
                    "Tracking",
                    <Chip key="t" tone="teal">
                      {data.setsCookies ? "Sets cookies" : "No cookies set"}
                    </Chip>,
                  ],
                  [
                    "Redirect type",
                    <span key="r" className="font-mono">
                      {data.redirectType} · {data.redirectType === "301" ? "permanent" : "temporary"}
                    </span>,
                  ],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 py-3 border-b border-line last:border-b-0 text-[13.5px]">
                  <span className="text-ink-3 w-[118px] shrink-0">{k}</span>
                  <span className="flex-1 flex items-center gap-2 justify-end text-right">{v}</span>
                </div>
              ))}
            </div>

            <div className="px-6 pt-[18px] pb-[22px] flex flex-col gap-[9px]">
              <a
                href={data.destination}
                rel="noopener noreferrer nofollow"
                className="px-[13px] py-[11px] rounded-[var(--radius-sm)] bg-accent text-accent-ink font-semibold text-[13px] text-center"
              >
                Continue to{" "}
                {(() => {
                  try {
                    return new URL(data.destination).hostname;
                  } catch {
                    return "the destination";
                  }
                })()}{" "}
                →
              </a>
              <Button className="justify-center">Report this link</Button>
            </div>
          </>
        )}
      </div>

      <p className="text-center text-[11.5px] text-ink-3 mt-4 leading-[1.6]">
        Anyone can see this page by adding <span className="font-mono text-accent">+</span> to the end of any SnapURL
        link.
        <br />
        We do not set cookies, and we never sell click data.
      </p>
    </div>
  );
}
