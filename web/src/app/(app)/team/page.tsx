"use client";

import { PageHead } from "@/components/app-shell";
import { Button, Card, CardBody, CardHeader, Chip, Field, Input, Segmented, Skeleton, Table, TableWrap, Td, Th } from "@/components/ui";
import { useAudit, useChangeMemberRole, useInviteMember, useMembers, useRemoveMember, useWorkspace } from "@/lib/api/hooks";
import { InviteMemberInput, type MemberRole } from "@snapurl/contract";
import { useRef, useState } from "react";
import { memberSummary } from "@/lib/plural";
import { cn, full, timeAgo } from "@/lib/utils";

const PERMISSIONS: { label: string; roles: [boolean, boolean, boolean, boolean] }[] = [
  { label: "View links & analytics", roles: [true, true, true, true] },
  { label: "Create & edit links", roles: [false, true, true, true] },
  { label: "Delete links", roles: [false, false, true, true] },
  { label: "Manage domains", roles: [false, false, true, true] },
  { label: "Invite & remove members", roles: [false, false, true, true] },
  { label: "API keys & webhooks", roles: [false, false, true, true] },
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

const roleLabel = (r: MemberRole) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

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
  /* Outcome of the last role change. Shown under the Members table, never above
     it, so reporting it cannot move the row being edited (#781). */
  const [roleNote, setRoleNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // A ref, not state: a double click delivers its second click before a re-render.
  const roleInFlight = useRef(false);

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

  async function setMemberRole(m: { id: string; name: string; role: MemberRole }, next: MemberRole) {
    /* #781: the editor stays open after a change (it closes only on Done / Esc),
       so a second click aimed at Done can never land on "Remove", which is not on
       the row while the editor is open. The outcome is reported in a reserved
       line below the table rather than in a card above it, so nothing shifts. */
    if (next === m.role || roleInFlight.current) return;
    roleInFlight.current = true;
    setProblem(null);
    setRoleNote(null);
    try {
      await changeRole.mutateAsync({ id: m.id, role: next });
      setRoleNote({ kind: "ok", text: `${m.name}'s role is now ${roleLabel(next)}.` });
    } catch (err) {
      // "This is the only owner" arrives here, and is the whole reason the
      // API refuses rather than letting a workspace become unadministrable.
      setRoleNote({ kind: "error", text: (err as Error).message });
    } finally {
      roleInFlight.current = false;
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
        sub={`${workspace?.name ?? "This workspace"} · ${members ? memberSummary(members) : "— members"} · every action is written to the audit log`}
        actions={
          <>
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
              <Field label="Role" controlId="team-invite-role">
                <Segmented id="team-invite-role" aria-label="Role" value={role} onChange={setRole} options={INVITE_ROLES} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={sendInvite} disabled={invite.isPending || !email.trim()}>
                {invite.isPending ? "Sending…" : "Send invitation"}
              </Button>
              <Button aria-label="Cancel inviting a member" onClick={() => { setInviting(false); setProblem(null); }}>Cancel</Button>
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
          <TableWrap label="Members">
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
                            "w-[29px] h-[29px] rounded-full grid place-items-center text-[11.5px] font-bold shrink-0",
                            /* text-accent-ink, not a literal white ink — see
                               #462. Every AVATAR_TONES background is a
                               saturated status/accent token that is
                               deliberately lightened in dark theme for its
                               primary text-on-surface use, which drops a
                               literal white ink to 1.84-2.76:1 there (accent
                               2.41, teal 2.23, violet 2.76, amber 2.12, good
                               1.84 — axe-core `color-contrast`, /team dark).
                               --accent-ink clears 4.5:1 against all five tones in
                               both themes (worst case 5.43:1 light, 6.62:1 dark). */
                            m.status === "invited" ? "bg-surface-4 text-ink-3" : `${AVATAR_TONES[i % AVATAR_TONES.length]} text-accent-ink`,
                          )}
                        >
                          {m.initials}
                        </span>
                        <div className="min-w-0">
                          <b className="block text-[13px] font-semibold text-ink truncate">{m.name}</b>
                          <span className="block text-[11.5px] text-ink-3 truncate">
                            {m.status === "invited" ? (m.invitedAt ? `Invited ${timeAgo(m.invitedAt)}` : "Invitation pending") : m.email}
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
                    <Td>{m.lastActive ? timeAgo(m.lastActive) : "—"}</Td>
                    <Td>
                      {m.status === "invited" ? "—" : <Chip tone={m.twoFactor ? "good" : "warn"}>{m.twoFactor ? "On" : "Off"}</Chip>}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {editing === m.id ? (
                        <div
                          className="inline-flex items-center gap-2"
                          onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }}
                        >
                          <Segmented
                            aria-label={`Role for ${m.email}`}
                            /* While the change is in flight show the role being set, not the old one. */
                            value={changeRole.isPending && changeRole.variables?.id === m.id ? changeRole.variables.role : m.role}
                            onChange={(next) => void setMemberRole(m, next)}
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
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(m.id); setConfirming(null); setProblem(null); setRoleNote(null); }}>
                            Change role
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setConfirming(m.id); setProblem(null); setRoleNote(null); }}>
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
        {/* Always mounted so the live regions announce, and always tall enough for
            one line so reporting a role change never moves anything. */}
        <div className="px-4 py-2 min-h-[2.25rem] text-[12.5px]">
          <span role="status" className="block text-good">{roleNote?.kind === "ok" ? roleNote.text : ""}</span>
          <span role="alert" className="block text-bad">{roleNote?.kind === "error" ? roleNote.text : ""}</span>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        <Card>
          <CardHeader title="What each role can do" />
          <TableWrap label="What each role can do">
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
                      <Td key={i} className={cn("text-center", allowed ? "text-good font-semibold" : "text-ink-3")}>
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
            <CardHeader title="Recent activity" />
            <CardBody className="flex flex-col gap-2.5 text-[12.5px]">
              {(audit ?? []).map((a) => (
                <div key={a.id} className="flex gap-[11px] items-baseline text-ink-2 leading-[1.5]">
                  <span className="font-mono text-ink-3 text-[11px] w-[84px] shrink-0">{timeAgo(a.at)}</span>
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
