"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardBody,
  CardHeader,
  Chip,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { useAdminUsers } from "@/lib/api/hooks";

/* #969 — the admin users list. Search by email or name; each row links to the
   user's detail page. A platform-wide view: no workspace role here, since a
   user has a role per workspace. */
export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const { data, isPending, isError, error, refetch } = useAdminUsers(search);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-1">Users</h1>
        <p className="mt-1 text-sm text-ink-3">Find and manage any account on the platform.</p>
      </div>

      <Card>
        <CardHeader title="All users" />
        <CardBody className="space-y-4">
          <Input
            type="search"
            placeholder="Search by email or name"
            aria-label="Search users"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {isError ? (
            <ErrorState message={error instanceof Error ? error.message : "Couldn't load users."} onRetry={() => refetch()} />
          ) : isPending ? (
            <div className="space-y-2" aria-hidden>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : data.items.length === 0 ? (
            <EmptyState title="No users found" body={search ? "Try a different search." : "No accounts yet."} />
          ) : (
            <>
              <TableWrap label="Users">
                <Table>
                  <thead>
                    <tr>
                      <Th>Email</Th>
                      <Th>Name</Th>
                      <Th>Status</Th>
                      <Th>Workspaces</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((u) => (
                      <tr key={u.id} className="hover:bg-surface-2">
                        <Td>
                          <Link href={`/admin/users/${u.id}`} className="font-medium text-ink-1 hover:underline">
                            {u.email}
                          </Link>
                        </Td>
                        <Td>{u.name}</Td>
                        <Td>
                          {u.suspendedAt ? (
                            <Chip tone="bad">Suspended</Chip>
                          ) : u.emailVerified ? (
                            <Chip tone="good">Active</Chip>
                          ) : (
                            <Chip tone="warn">Unverified</Chip>
                          )}
                        </Td>
                        <Td>{u.workspaceCount}</Td>
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
