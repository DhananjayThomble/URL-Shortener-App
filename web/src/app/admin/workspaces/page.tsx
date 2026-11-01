"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { useAdminWorkspaces } from "@/lib/api/hooks";

/* #969 — the admin workspaces list. Search by name or slug; each row links to
   the workspace detail page (members, usage, plan/limit edit, view-as). */
export default function AdminWorkspacesPage() {
  const [search, setSearch] = useState("");
  const { data, isPending, isError, error, refetch } = useAdminWorkspaces(search);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-1">Workspaces</h1>
        <p className="mt-1 text-sm text-ink-3">Every workspace on the platform.</p>
      </div>

      <Card>
        <CardHeader title="All workspaces" />
        <CardBody className="space-y-4">
          <Input
            type="search"
            placeholder="Search by name or slug"
            aria-label="Search workspaces"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {isError ? (
            <ErrorState
              message={error instanceof Error ? error.message : "Couldn't load workspaces."}
              onRetry={() => refetch()}
            />
          ) : isPending ? (
            <div className="space-y-2" aria-hidden>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : data.items.length === 0 ? (
            <EmptyState title="No workspaces found" body={search ? "Try a different search." : "None yet."} />
          ) : (
            <>
              <TableWrap label="Workspaces">
                <Table>
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Slug</Th>
                      <Th>Plan</Th>
                      <Th>Members</Th>
                      <Th>Links</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((w) => (
                      <tr key={w.id} className="hover:bg-surface-2">
                        <Td>
                          <Link href={`/admin/workspaces/${w.id}`} className="font-medium text-ink-1 hover:underline">
                            {w.name}
                          </Link>
                        </Td>
                        <Td className="text-ink-3">/{w.slug}</Td>
                        <Td>{w.plan}</Td>
                        <Td>{w.memberCount}</Td>
                        <Td>{w.linkCount}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
              <p className="text-xs text-ink-3">
                Showing {data.items.length} of {data.total}.
              </p>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
