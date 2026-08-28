"use client";

import { PageHead } from "@/components/app-shell";
import { Button, Card, CardBody, CardHeader, Chip, Skeleton, Table, TableWrap, Td, Th } from "@/components/ui";
import { useAudit, useMembers } from "@/lib/api/hooks";
import { cn, full } from "@/lib/utils";

const PERMISSIONS: { label: string; roles: [boolean, boolean, boolean, boolean] }[] = [
  { label: "View links & analytics", roles: [true, true, true, true] },
  { label: "Create & edit links", roles: [false, true, true, true] },
  { label: "Delete links", roles: [false, false, true, true] },
  { label: "Manage domains", roles: [false, false, true, true] },
  { label: "Invite & remove members", roles: [false, false, true, true] },
  { label: "API keys & webhooks", roles: [false, false, true, true] },
  { label: "Billing & plan", roles: [false, false, false, true] },
  { label: "Delete workspace", roles: [false, false, false, true] },
];

const AVATAR_TONES = ["bg-accent", "bg-teal", "bg-violet", "bg-amber", "bg-good"];

export default function TeamPage() {
  const { data: members, isLoading } = useMembers();
  const { data: audit } = useAudit();

  return (
    <>
      <PageHead
        title="Team"
        sub={`${members?.length ?? "—"} members in Acme Growth · every action is written to the audit log`}
        actions={
          <>
            <Button>Audit log</Button>
            <Button variant="primary">＋ Invite</Button>
          </>
        }
      />

      <Card className="mb-3.5">
        <CardHeader title="Members" />
        {isLoading ? (
          <CardBody>
            <Skeleton className="h-[200px]" />
          </CardBody>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>Role</Th>
                  <Th>Links</Th>
                  <Th>Last active</Th>
                  <Th>2FA</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {(members ?? []).map((m, i) => (
                  <tr key={m.id}>
                    <Td>
                      <div className="flex items-center gap-[10px]">
                        <span
                          className={cn(
                            "w-[29px] h-[29px] rounded-full grid place-items-center text-[11.5px] font-bold text-white shrink-0",
                            m.status === "invited" ? "bg-surface-4 text-ink-3" : AVATAR_TONES[i % AVATAR_TONES.length],
                          )}
                        >
                          {m.initials}
                        </span>
                        <div className="min-w-0">
                          <b className="block text-[13px] font-semibold text-ink truncate">{m.name}</b>
                          <span className="block text-[11.5px] text-ink-3 truncate">
                            {m.status === "invited" ? "Invited 2 days ago" : m.email}
                          </span>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <Chip tone={m.role === "owner" ? "accent" : m.status === "invited" ? "warn" : "default"}>
                        {m.role[0].toUpperCase() + m.role.slice(1)}
                        {m.status === "invited" ? " · pending" : ""}
                      </Chip>
                    </Td>
                    <Td className="tnum">{m.status === "invited" ? "—" : full(m.links)}</Td>
                    <Td>{m.lastActive ?? "—"}</Td>
                    <Td>
                      {m.status === "invited" ? "—" : <Chip tone={m.twoFactor ? "good" : "warn"}>{m.twoFactor ? "On" : "Off"}</Chip>}
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost">
                        {m.status === "invited" ? "Resend" : "⋯"}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        <Card>
          <CardHeader title="What each role can do" />
          <TableWrap>
            <Table className="min-w-[440px]">
              <thead>
                <tr>
                  <Th>Permission</Th>
                  <Th className="text-center">Viewer</Th>
                  <Th className="text-center">Editor</Th>
                  <Th className="text-center">Admin</Th>
                  <Th className="text-center">Owner</Th>
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((p) => (
                  <tr key={p.label}>
                    <Td className="text-ink font-medium">{p.label}</Td>
                    {p.roles.map((allowed, i) => (
                      <Td key={i} className={cn("text-center", allowed ? "text-good font-semibold" : "text-ink-3 opacity-50")}>
                        {allowed ? "✓" : "—"}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>

        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="Recent activity" right={<Button size="sm" variant="ghost">Full log</Button>} />
            <CardBody className="flex flex-col gap-2.5 text-[12.5px]">
              {(audit ?? []).map((a) => (
                <div key={a.id} className="flex gap-[11px] items-baseline text-ink-2 leading-[1.5]">
                  <span className="font-mono text-ink-3 text-[11px] w-[38px] shrink-0">{a.at}</span>
                  <span>
                    <b className="text-ink font-semibold">{a.actor}</b> {a.action}
                  </span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
