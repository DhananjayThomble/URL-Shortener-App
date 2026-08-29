"use client";

import { PageHead } from "@/components/app-shell";
import { Button, Card, CardBody, CardHeader, Chip, Field, Input, Segmented, Skeleton, Table, TableWrap, Td, Th } from "@/components/ui";
import { useAudit, useChangeMemberRole, useInviteMember, useMembers, useRemoveMember, useWorkspace } from "@/lib/api/hooks";
import { InviteMemberInput, type MemberRole } from "@snapurl/contract";
import { useState } from "react";
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

/* Owner is excluded: transferring ownership is a role change on an existing
   member, not something you can hand out with an invitation. */
const INVITE_ROLES: { value: Exclude<MemberRole, "owner">; label: string }[] = [
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Admin" },
];

const ROLE_OPTIONS: { value: MemberRole; label: string }[] = [...INVITE_ROLES, { value: "owner", label: "Owner" }];

export default function TeamPage() {
  const { data: members, isLoading } = useMembers();
  const { data: workspace } = useWorkspace();
  const { data: audit } = useAudit();

  const invite = useInviteMember();
  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();

  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<MemberRole, "owner">>("editor");
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function sendInvite() {
    const parsed = InviteMemberInput.safeParse({ email: email.trim(), role });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? "That doesn't look like an email address.");
      return;
    }
    try {
      await invite.mutateAsync(parsed.data);
      setEmail("");
      setInviting(false);
      setProblem(null);
    } catch (err) {
      setProblem((err as Error).message);
    }
  }

  async function setMemberRole(id: string, next: MemberRole) {
    setProblem(null);
    try {
      await changeRole.mutateAsync({ id, role: next });
      setEditing(null);
    } catch (err) {
      // "This is the only owner" arrives here, and is the whole reason the
      // API refuses rather than letting a workspace become unadministrable.
      setProblem((err as Error).message);
      setEditing(null);
    }
  }

  async function remove(id: string) {
    setProblem(null);
    try {
      await removeMember.mutateAsync(id);
      setConfirming(null);
    } catch (err) {
      setProblem((err as Error).message);
      setConfirming(null);
    }
  }

  return (
    <>
      <PageHead
        title="Team"
        sub={`${members?.length ?? "—"} members in ${workspace?.name ?? "this workspace"} · every action is written to the audit log`}
        actions={
          <>
            <Button>Audit log</Button>
            <Button variant="primary" onClick={() => { setInviting((v) => !v); setProblem(null); }}>
              {inviting ? "Cancel" : "＋ Invite"}
            </Button>
          </>
        }
      />

      {inviting ? (
        <Card className="mb-3.5">
          <CardHeader title="Invite a teammate" />
          <CardBody className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
              <Field label="Email" error={problem ?? undefined}>
                <Input
                  value={email}
                  autoFocus
                  placeholder="teammate@example.com"
                  onChange={(e) => { setEmail(e.target.value); setProblem(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void sendInvite(); }}
                />
              </Field>
              <Field label="Role">
                <Segmented value={role} onChange={setRole} options={INVITE_ROLES} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={sendInvite} disabled={invite.isPending || !email.trim()}>
                {invite.isPending ? "Sending…" : "Send invitation"}
              </Button>
              <Button onClick={() => { setInviting(false); setProblem(null); }}>Cancel</Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {problem && !inviting ? (
        <Card className="mb-3.5 border-bad">
          <CardBody className="text-[13px] text-bad">{problem}</CardBody>
        </Card>
      ) : null}

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
                    <Td className="text-right whitespace-nowrap">
                      {editing === m.id ? (
                        <div className="inline-flex items-center gap-2">
                          <Segmented
                            value={m.role}
                            onChange={(next) => setMemberRole(m.id, next)}
                            options={ROLE_OPTIONS}
                          />
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Done
                          </Button>
                        </div>
                      ) : confirming === m.id ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                            Keep
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => remove(m.id)} disabled={removeMember.isPending}>
                            Remove
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(m.id); setProblem(null); }}>
                            Change role
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setConfirming(m.id); setProblem(null); }}>
                            Remove
                          </Button>
                        </>
                      )}
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
