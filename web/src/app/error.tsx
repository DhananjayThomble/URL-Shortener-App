"use client";

/* ============================================================
   #997 — the app-wide error page.

   Next renders this route-segment error boundary when a page under app/ throws
   while rendering. It is exactly where a user most wants to report a problem,
   so it carries the same "Report a problem" control the app shell does — and
   threads Next's error `digest` through as the error-tracking event id (#995),
   so a report filed from here is already correlated with the thrown error
   without any vendor SDK.

   A plain, dependency-light page: it must render even when the thing that threw
   was the app shell itself, so it does not mount the shell or any workspace
   query.
   ============================================================ */

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui";
import { ReportProblemButton } from "@/components/feedback/report-problem";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // #995 — report the error to Sentry and keep its event id, so a "Report a
  // problem" filed from this page links straight to the captured crash. When
  // error tracking is off (no DSN) captureException returns a locally-generated
  // id that no event matches, so we fall back to Next's error digest, which is
  // what this page used before an error tracker existed.
  const [eventId, setEventId] = useState<string | undefined>(error.digest);
  useEffect(() => {
    const id = Sentry.captureException(error);
    if (Sentry.isInitialized()) setEventId(id);
    // Surface it in the console in dev too.
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-[460px] flex flex-col gap-4 text-center">
        <h1 className="text-[20px] font-bold text-ink">Something went wrong</h1>
        <p className="m-0 text-[13.5px] text-ink-3 leading-[1.6]">
          Sorry — this page hit an error. You can try again, and if it keeps happening, tell us what you were doing and
          we&apos;ll look into it.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-2 pt-1">
          <Button variant="primary" onClick={reset} className="justify-center min-h-[40px]">
            Try again
          </Button>
          {/* The Sentry event id (when error tracking is on) or Next's error
              digest (when it is off) — attach it as the error-tracking event id
              so the report links back to this exact error instance (#995/#997). */}
          <ReportProblemButton
            label="Report a problem"
            variant="default"
            context={eventId ? { errorEventId: eventId } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
