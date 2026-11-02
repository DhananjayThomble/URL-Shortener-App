"use client";

/* #995 — the root-level error boundary.

   Next renders this only when the ROOT layout itself throws, which the ordinary
   app/error.tsx cannot catch (it lives inside that layout). It must render its
   own <html>/<body>. Its one job here is to make sure an error that takes down
   the whole shell is still reported to Sentry — a no-op when error tracking is
   off (no DSN). Kept dependency-light: no app shell, no workspace query. */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <div style={{ maxWidth: 460, textAlign: "center" }}>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>Something went wrong</h1>
            <p style={{ color: "#4a5766", fontSize: 14, lineHeight: 1.6 }}>
              Sorry — the app hit an error it couldn&apos;t recover from. Please reload the page.
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
