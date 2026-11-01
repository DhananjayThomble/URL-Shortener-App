"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Chip, ErrorState, Skeleton } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  useAdminDeleteUser,
  useAdminResendVerification,
  useAdminSignOutEverywhere,
  useAdminSuspendUser,
  useAdminUnsuspendUser,
  useAdminUser,
} from "@/lib/api/hooks";

/* #969 — the admin user detail page: the account, its workspaces, and the
   account actions. Each action is a single button that calls its endpoint; the
   destructive one (delete) is behind a confirm dialog. Every action records an
   audit row on the server. */
export default function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: user, isPending, isError, error, refetch } = useAdminUser(id);

  const suspend = useAdminSuspendUser();
  const unsuspend = useAdminUnsuspendUser();
  const signOut = useAdminSignOutEverywhere();
  const resend = useAdminResendVerification();
  const del = useAdminDeleteUser();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const busy =
    suspend.isPending || unsuspend.isPending || signOut.isPending || resend.isPending || del.isPending;

  function run(label: string, p: Promise<unknown>) {
    setNotice(null);
    p.then(() => setNotice(`${label} done.`)).catch((e: unknown) =>
      setNotice(e instanceof Error ? e.message : `${label} failed.`),
    );
  }

  if (isError) {
    return <ErrorState message={error instanceof Error ? error.message : "Couldn't load this user."} onRetry={() => refetch()} />;
  }
  if (isPending) {
    return (
      <div className="space-y-4" aria-hidden>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/users" className="text-xs text-ink-3 hover:text-ink-1">
          ← Users
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-ink-1">{user.name}</h1>
        <p className="text-sm text-ink-3">{user.email}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {user.suspendedAt ? <Chip tone="bad">Suspended</Chip> : <Chip tone="good">Active</Chip>}
          {user.emailVerified ? <Chip tone="good">Email verified</Chip> : <Chip tone="warn">Email unverified</Chip>}
          {user.twoFactorEnabled ? <Chip tone="teal">2FA on</Chip> : <Chip>2FA off</Chip>}
        </div>
      </div>

      {notice ? (
        <p className="text-sm text-ink-2" role="status">
          {notice}
        </p>
      ) : null}

      <Card>
        <CardHeader title="Actions" />
        <CardBody className="flex flex-wrap gap-2">
          {user.suspendedAt ? (
            <Button disabled={busy} onClick={() => run("Unsuspend", unsuspend.mutateAsync(id))}>
              Unsuspend
            </Button>
          ) : (
            <Button variant="danger" disabled={busy} onClick={() => run("Suspend", suspend.mutateAsync(id))}>
              Suspend
            </Button>
          )}
          <Button disabled={busy} onClick={() => run("Sign out everywhere", signOut.mutateAsync(id))}>
            Sign out everywhere
          </Button>
          {!user.emailVerified ? (
            <Button disabled={busy} onClick={() => run("Resend verification", resend.mutateAsync(id))}>
              Resend verification
            </Button>
          ) : null}
          <Button variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete account
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Workspaces" />
        <CardBody>
          {user.workspaces.length === 0 ? (
            <p className="text-sm text-ink-3">Not a member of any workspace.</p>
          ) : (
            <ul className="divide-y divide-line-1">
              {user.workspaces.map((w) => (
                <li key={w.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/admin/workspaces/${w.id}`} className="text-ink-1 hover:underline">
                    {w.name} <span className="text-ink-3">/{w.slug}</span>
                  </Link>
                  <span className="flex items-center gap-2 text-ink-3">
                    <Chip>{w.role}</Chip>
                    <span>{w.plan}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this account?"
        body={`This permanently deletes ${user.email} and any workspace they solely own. This cannot be undone.`}
        confirmLabel="Delete account"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          del
            .mutateAsync(id)
            .then(() => router.replace("/admin/users"))
            .catch((e: unknown) => setNotice(e instanceof Error ? e.message : "Delete failed."));
        }}
      />
    </div>
  );
}
