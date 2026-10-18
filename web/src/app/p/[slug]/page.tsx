"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Chip, ErrorState, Field, Input, Skeleton } from "@/components/ui";
import { useLinkLock, useLinkPreview, useReportLink, useUnlockLink } from "@/lib/api/hooks";
import { needsLockLookup, previewView, trustPage } from "@/lib/link-preview";
import { trustState } from "@/lib/trust-state";
import { formatDate, relativeDate } from "@/lib/utils";

/** shortUrl is "domain/slug" with no scheme; localhost is the dev redirect. */
function withUnlockKey(shortUrl: string, token: string): string {
  const scheme = /^(localhost|127\.0\.0\.1)/.test(shortUrl) ? "http" : "https";
  const url = new URL(/^https?:\/\//.test(shortUrl) ? shortUrl : `${scheme}://${shortUrl}`);
  url.searchParams.set("k", token);
  return url.toString();
}

/* The public trust page. Anyone can reach it by adding "+" to a short link;
   the redirect service rewrites that to /p/<slug>. No auth, no cookies. */
export default function LinkPreviewPage() {
  const { slug } = useParams<{ slug: string }>();
  /* G3 — the redirect service bounces a password-protected link here as
     ?unlock=1 and waits for the visitor to come back with ?k=<token>. The
     page ignored the parameter entirely, so those links were unreachable:
     the redirect sent people to a page that offered no way to continue.

     Whether the password form shows is decided by the preview itself
     (`passwordProtected`), not by the parameter: the "+" preview of a protected
     link needs the form too, and a stale ?unlock=1 on a link whose password
     was removed must not ask for one. The parameter only decides whether the
     form takes focus — the visitor came here to unlock, not to inspect. */
  const searchParams = useSearchParams();
  const unlockRequested = searchParams.get("unlock") === "1";
  /* #800 — the redirect bounces here with ?host=<the domain it resolved the
     slug on>. One slug can live on several domains, so preview/lock/unlock
     must be scoped to that same host or they can answer for a different
     domain's link (wrong password rejected, wrong short URL). Empty when an
     older redirect bounced without it; the API then falls back to slug-only. */
  const host = searchParams.get("host") ?? undefined;
  const { data, error, isPending, refetch } = useLinkPreview(slug, host);
  /* #762 — with public previews off the preview 403s; the lock route (never
     the destination, not gated by the switch) says whether to draw the bare
     password form instead of an error. Asked for on that 403 only. */
  const lock = useLinkLock(slug, needsLockLookup(error), host);
  const page = trustPage({
    preview: { pending: isPending, data, error },
    lock: { pending: lock.isPending, data: lock.data, error: lock.error },
  });
  /* The only URL the unlock may send the visitor to: back through the short
     link, from whichever payload the page drew the form from. */
  const shortUrl = data?.shortUrl ?? (page.kind === "lock" ? page.shortUrl : null);
  const view = data ? previewView(data) : null;
  /* A flagged link redirects here with ?warning=unsafe. The preview's own
     status is the source of truth; the param only escalates it (#647). */
  const trust = trustState(data?.safeBrowsing ?? "pending", searchParams.get("warning"));
  const unlock = useUnlockLink(slug, host);
  const report = useReportLink(slug);

  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  /* The report form is a disclosure: closed by default so the trust page stays
     calm, opened by the "Report this link" button. `reported` only flips true
     after the request resolves — the whole point of #291 is that we never tell
     a victim their report landed before it actually did. */
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("Phishing / scam");
  const [contact, setContact] = useState("");
  const [reportProblem, setReportProblem] = useState<string | null>(null);
  const [reported, setReported] = useState(false);

  async function submitPassword() {
    if (!password || !shortUrl) return;
    try {
      const { unlockToken } = await unlock.mutateAsync({ password });
      // The token is bound to this link and expires in five minutes, so it is
      // handed straight back to the redirect rather than kept anywhere.
      window.location.href = withUnlockKey(shortUrl, unlockToken);
    } catch (err) {
      setProblem((err as Error).message);
    }
  }

  async function submitReport() {
    if (!reason) return;
    setReportProblem(null);
    try {
      await report.mutateAsync({ reason, reporterContact: contact || undefined });
      // Only now, after the server acknowledged, do we say it was received.
      setReported(true);
    } catch (err) {
      setReportProblem((err as Error).message);
    }
  }

  /* The password form, drawn by both the full preview and the previews-off
     lock view (#762). The ?unlock=1 parameter only decides focus. */
  const passwordForm = (
    <div className="px-6 pt-[18px] pb-[6px]">
      <Field
        label="This link is password protected"
        help="Ask whoever shared it for the password. We check it on the server and never store it in your browser."
        error={problem ?? undefined}
      >
        <Input
          type="password"
          value={password}
          autoFocus={unlockRequested}
          placeholder="Password"
          onChange={(e) => { setPassword(e.target.value); setProblem(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void submitPassword(); }}
        />
      </Field>
      <Button
        variant="primary"
        className="justify-center w-full mt-3"
        onClick={submitPassword}
        disabled={unlock.isPending || !password}
      >
        {unlock.isPending ? "Checking…" : "Unlock and continue"}
      </Button>
    </div>
  );

  const reportControls = reported ? (
    <Chip tone="good" dot>
      Report received — thank you
    </Chip>
  ) : reportOpen ? (
    <div className="flex flex-col gap-[9px]">
      <Field label="What's wrong with this link?">
        <select
          value={reason}
          onChange={(e) => { setReason(e.target.value); setReportProblem(null); }}
          className="w-full px-[11px] py-[9px] rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[13px] text-ink focus:outline-none focus:border-accent focus:bg-surface focus:ring-[3px] focus:ring-accent-wash"
        >
          <option>Phishing / scam</option>
          <option>Malware</option>
          <option>Spam</option>
          <option>Other</option>
        </select>
      </Field>
      <Field
        label="Your email (optional)"
        help="Only if you'd like the operator to be able to follow up. We never share it."
        error={reportProblem ?? undefined}
      >
        <Input
          type="email"
          value={contact}
          placeholder="you@example.com"
          onChange={(e) => { setContact(e.target.value); setReportProblem(null); }}
        />
      </Field>
      <Button
        variant="primary"
        className="justify-center w-full"
        onClick={submitReport}
        disabled={report.isPending || !reason}
      >
        {report.isPending ? "Reporting…" : "Submit report"}
      </Button>
    </div>
  ) : (
    <Button className="justify-center" onClick={() => setReportOpen(true)}>
      Report this link
    </Button>
  );

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
        {page.kind === "error" ? (
          <ErrorState
            message={page.message}
            onRetry={() => {
              void refetch();
              if (lock.isError) void lock.refetch();
            }}
          />
        ) : page.kind === "loading" ? (
          <div className="p-6 flex flex-col gap-3">
            <Skeleton className="h-[46px] w-[46px] rounded-[13px] mx-auto" />
            <Skeleton className="h-5 w-2/3 mx-auto" />
            <Skeleton className="h-[70px]" />
            <Skeleton className="h-[180px]" />
          </div>
        ) : page.kind === "lock" ? (
          /* #762 — previews are off, so nothing the owner hid: no creator,
             dates or scan state. Just the short link and the password. */
          <>
            <div className="p-6 border-b border-line text-center">
              <div
                className={`w-[46px] h-[46px] rounded-[13px] grid place-items-center text-[21px] mx-auto mb-3.5 ${
                  trust.kind === "flagged" ? trust.iconClass : "bg-accent-wash text-accent"
                }`}
              >
                {trust.kind === "flagged" ? trust.icon : "🔒"}
              </div>
              <h2 className="text-[19px] font-bold">
                {trust.kind === "flagged" ? trust.heading : "Password required"}
              </h2>
              {trust.notice ? (
                <p role="alert" className="mt-2 text-[13px] leading-[1.6] text-bad">
                  {trust.notice}
                </p>
              ) : null}
            </div>
            <div className="px-6 py-[18px] bg-surface-2 border-b border-line">
              <div className="font-mono text-[9.5px] tracking-[0.13em] uppercase text-ink-3 mb-[7px]">Where it goes</div>
              <div className="text-[13.5px] text-ink-2 leading-[1.6]">
                {trust.kind === "flagged"
                  ? "🔒 Hidden. This link was flagged, so we don't send anyone to it."
                  : "🔒 Hidden until you enter the password. The owner protected this link."}
              </div>
            </div>
            <div className="px-6">
              <div className="flex items-center gap-3 py-3 text-[13.5px]">
                <span className="text-ink-3 w-[118px] shrink-0">Short link</span>
                <span className="flex-1 flex items-center gap-2 justify-end text-right font-mono break-all">
                  {page.shortUrl}
                </span>
              </div>
            </div>
            {/* #800 — a flagged link reaches here via ?warning=unsafe, and the
                redirect's flagged gate runs BEFORE the password gate: even with
                the right password the redirect would bounce the visitor
                straight back here. Offering the form would be an endless loop,
                so a flagged link shows the warning and the report control only,
                never the password form. */}
            {trust.kind === "flagged" ? null : passwordForm}
            <div className="px-6 pt-[18px] pb-[22px] flex flex-col gap-[9px]">{reportControls}</div>
          </>
        ) : data ? (
          <>
            <div className="p-6 border-b border-line text-center">
              <div
                className={`w-[46px] h-[46px] rounded-[13px] grid place-items-center text-[21px] mx-auto mb-3.5 ${trust.iconClass}`}
              >
                {trust.icon}
              </div>
              <h2 className="text-[19px] font-bold">{trust.heading}</h2>
              {trust.notice ? (
                <p role="alert" className="mt-2 text-[13px] leading-[1.6] text-bad">
                  {trust.notice}
                </p>
              ) : null}
            </div>

            <div className="px-6 py-[18px] bg-surface-2 border-b border-line">
              <div className="font-mono text-[9.5px] tracking-[0.13em] uppercase text-ink-3 mb-[7px]">Where it goes</div>
              {view?.kind === "open" ? (
                <div className="font-mono text-[13.5px] break-all text-ink leading-[1.6]">{view.destination}</div>
              ) : (
                <div className="text-[13.5px] text-ink-2 leading-[1.6]">
                  🔒 Hidden until you enter the password. The owner protected this link.
                </div>
              )}
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
                    <Chip key="sb" tone={trust.chipTone} dot>
                      {trust.chipLabel}
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

            {view?.kind === "locked" ? passwordForm : null}

            <div className="px-6 pt-[18px] pb-[22px] flex flex-col gap-[9px]">
              {/* No direct link for a locked one: the href would be the very URL
                  the password guards. Unlock above goes through the redirect. */}
              {view?.kind === "open" ? (
                <a
                  href={view.destination}
                  rel="noopener noreferrer nofollow"
                  className={`px-[13px] py-[11px] rounded-[var(--radius-sm)] font-semibold text-[13px] text-center ${
                    trust.kind === "flagged"
                      ? "bg-surface border border-line-2 text-ink-2 hover:bg-surface-3"
                      : "bg-accent text-accent-ink"
                  }`}
                >
                  {trust.continueLabel} {view.host} →
                </a>
              ) : null}
              {reportControls}
            </div>
          </>
        ) : null}
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
