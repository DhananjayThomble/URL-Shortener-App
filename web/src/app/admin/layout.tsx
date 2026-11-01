import type { Metadata } from "next";
import { AdminGate } from "./admin-gate";

/* #968 — the /admin route group.

   This layout is a Server Component: it is the server-rendered boundary that
   wraps every /admin page, and nothing in the subtree renders until it has. It
   delegates the access decision to AdminGate, which asks the API (GET /admin/me)
   — the authoritative, server-side platform-admin check lives in the NestJS
   AdminGuard, and admin page content is only ever mounted once that check has
   passed. A non-admin sees the "not authorised" page and never the admin UI.

   (This project deliberately has no Next route handlers and holds its session
   token in the browser, so the token is not readable in this server component
   directly — see web/src/lib/api/client.ts. The server-side authority is the
   API guard; this boundary gates the subtree and reveals admin UI only after
   the server confirms.) */

export const metadata: Metadata = {
  title: "Admin · SnapURL",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
