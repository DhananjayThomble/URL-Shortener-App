"use client";

import * as React from "react";
import { SCREENSHOT_MAX_CHARS, type SubmitFeedbackInput } from "@snapurl/contract";
import { Button } from "@/components/ui";
import { useSubmitFeedback } from "@/lib/api/hooks";

/* ============================================================
   #997 — the in-app "Report a problem" control.

   A button that opens a small dialog: free text, an optional screenshot, and —
   attached automatically, never typed by the user — the page it was filed from,
   the browser user-agent and the app version. An error-tracking event id (#995)
   is attached when the host page provides one. Works signed in or out: the
   intake is @Public and the API attaches the signed-in submitter's identity
   from the session, so this component sends no identity of its own.

   Rendered in the app shell (every signed-in page) and on error pages (where a
   user most wants to report a problem). The trigger is a plain Button so each
   caller can place it where it fits; the dialog owns all the behaviour.
   ============================================================ */

/* The screenshot is read into a data URL in the browser, so it can be bounded
   and type-checked before it ever leaves the page. Matches ScreenshotDataUrl in
   the contract (PNG/JPEG/WebP, under ~1 MB). */
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** The context the client captures automatically. `errorEventId` is threaded in
 *  by an error page that has one; the shell passes none. */
export interface ReportProblemContext {
  errorEventId?: string;
}

/** Read the page, user-agent and app version from the live environment. Kept a
 *  function (not a module constant) so each open captures the CURRENT page. */
function captureContext(): Pick<SubmitFeedbackInput, "page" | "appVersion"> & { userAgentPresent: boolean } {
  const page = typeof window !== "undefined" ? window.location.pathname + window.location.search : undefined;
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || undefined;
  // The user-agent is captured server-side from the request header (never the
  // body), so we do not send it; this flag is only for the "what we attach"
  // summary the dialog shows the user.
  return { page, appVersion, userAgentPresent: typeof navigator !== "undefined" };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

/** The button + dialog. `label` and `variant` let the shell and the error pages
 *  present the same control differently (a quiet ghost link vs a primary CTA). */
export function ReportProblemButton({
  label = "Report a problem",
  variant = "ghost",
  size = "sm",
  context,
  className,
}: {
  label?: string;
  variant?: "primary" | "default" | "ghost" | "danger";
  size?: "sm" | "default" | "lg";
  context?: ReportProblemContext;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        data-testid="report-problem-trigger"
      >
        {label}
      </Button>
      {open ? <ReportProblemDialog context={context} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ReportProblemDialog({ context, onClose }: { context?: ReportProblemContext; onClose: () => void }) {
  const submit = useSubmitFeedback();
  const ref = React.useRef<HTMLDivElement>(null);
  const firstFieldRef = React.useRef<HTMLTextAreaElement>(null);
  const uid = React.useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;

  const [message, setMessage] = React.useState("");
  const [screenshot, setScreenshot] = React.useState<string | undefined>(undefined);
  const [screenshotName, setScreenshotName] = React.useState<string | undefined>(undefined);
  const [fileError, setFileError] = React.useState<string | undefined>(undefined);
  const [done, setDone] = React.useState(false);

  const ctx = React.useMemo(captureContext, []);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // Focus trap + escape + scroll lock, mirroring ConfirmDialog.
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const trigger = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, []);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(undefined);
    const file = e.target.files?.[0];
    if (!file) {
      setScreenshot(undefined);
      setScreenshotName(undefined);
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setFileError("Attach a PNG, JPEG or WebP image.");
      setScreenshot(undefined);
      setScreenshotName(undefined);
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl.length > SCREENSHOT_MAX_CHARS) {
        setFileError("That image is too large — keep it under about 1 MB.");
        setScreenshot(undefined);
        setScreenshotName(undefined);
        return;
      }
      setScreenshot(dataUrl);
      setScreenshotName(file.name);
    } catch {
      setFileError("Could not read that file.");
    }
  };

  const canSubmit = message.trim().length >= 3 && !submit.isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const input: SubmitFeedbackInput = {
      message: message.trim(),
      page: ctx.page,
      appVersion: ctx.appVersion,
      ...(context?.errorEventId ? { errorEventId: context.errorEventId } : {}),
      ...(screenshot ? { screenshot } : {}),
    };
    submit.mutate(input, { onSuccess: () => setDone(true) });
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-[rgb(6_10_15/0.5)] z-[110] backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-[111] flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className="pointer-events-auto w-full max-w-[480px] max-h-full overflow-y-auto bg-surface border border-line-2 rounded-[var(--radius)] shadow-[var(--shadow-3)] p-5 flex flex-col gap-3"
        >
          <h2 id={titleId} className="m-0 text-[16px] font-bold text-ink">
            Report a problem
          </h2>

          {done ? (
            <div className="flex flex-col gap-3" data-testid="report-problem-done">
              <p className="m-0 text-[13px] text-ink-2 leading-[1.6]" role="status">
                Thanks — your report was sent. We&apos;ll take a look.
              </p>
              <div className="flex justify-end">
                <Button onClick={onClose} className="justify-center min-h-[40px]">
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <form className="flex flex-col gap-3" onSubmit={onSubmit}>
              <p id={descId} className="m-0 text-[13px] text-ink-3 leading-[1.6]">
                Tell us what went wrong. We&apos;ll attach the page you&apos;re on, your browser and the app version
                automatically.
              </p>

              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-ink-2">What happened?</span>
                <textarea
                  ref={firstFieldRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  required
                  placeholder="The share button does nothing when I click it…"
                  aria-label="What happened?"
                  className="w-full resize-y rounded-[var(--radius-sm)] border border-line bg-surface-2 px-[11px] py-[8px] text-[13px] text-ink outline-none focus:border-line-2"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-ink-2">Screenshot (optional)</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onPickFile}
                  aria-label="Attach a screenshot"
                  className="text-[12px] text-ink-2 file:mr-2 file:rounded-[var(--radius-sm)] file:border file:border-line file:bg-surface-2 file:px-2 file:py-1 file:text-[12px] file:text-ink-2"
                />
                {screenshotName ? (
                  <span className="text-[11.5px] text-ink-3">Attached: {screenshotName}</span>
                ) : null}
                {fileError ? (
                  <span className="text-[11.5px] text-bad" role="alert">
                    {fileError}
                  </span>
                ) : null}
              </label>

              {submit.isError ? (
                <p className="m-0 text-[12px] text-bad" role="alert">
                  {submit.error instanceof Error ? submit.error.message : "Could not send your report. Try again."}
                </p>
              ) : null}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
                <Button type="button" onClick={onClose} className="justify-center min-h-[40px]">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!canSubmit}
                  className="justify-center min-h-[40px]"
                >
                  {submit.isPending ? "Sending…" : "Send report"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
