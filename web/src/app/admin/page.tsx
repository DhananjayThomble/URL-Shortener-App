"use client";

import { Card, CardBody, CardHeader } from "@/components/ui";

/* #968 — the admin overview. The foundation part ships the shell and this
   landing panel; later parts of the epic (#975) fill the area with the real
   platform tools. Reaching this page at all means the server confirmed the
   caller is a platform admin (AdminGate). */
export default function AdminOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-1">Platform admin</h1>
        <p className="mt-1 text-sm text-ink-3">
          Tools for acting on the whole platform. Every action here is recorded in the admin audit log.
        </p>
      </div>

      <Card>
        <CardHeader title="Overview" />
        <CardBody>
          <p className="text-sm text-ink-3">
            This is the foundation of the admin area. More tools arrive as the admin panel is built out.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
