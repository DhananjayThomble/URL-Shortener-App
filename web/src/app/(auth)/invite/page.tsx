"use client";

import { InviteErrorCode } from "@snapurl/contract";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { useAcceptInvite, useLogout, useMe, useResendEmailVerification } from "@/lib/api/hooks";
import { withNext } from "@/lib/safe-next";

/* ============================================================
   /invite?token=… — the link in the team invitation email (#668).

   Three kinds of visitor, all ending in POST /auth/invite/accept:
   - signed in        → one click to accept;
   - signed out, has an account → /login?next=<this page>, back here, accept;
   - new              → /register?next=<this page>, verify email, accept.

   Accepting is never automatic: a link opened by a mail scanner or an
   unfurling bot must not join anyone to anything, so it takes a click.

   The API refuses with a stable `code` (InviteErrorCode). This page branches
   on that, not on the message — toApiError rewrites every 403 message to a
   generic one, and both email_unverified and invite_email_mismatch are 403s.
   ============================================================ */

// No dynamic segment, so Next statically prerenders this route; useSearchParams
// needs a Suspense boundary for that (same as reset-password/page.tsx).
export default function InvitePage() {
  return (
    <Suspense fallback={null}>
      <InviteContent />
    </Suspense>
  );
}

const COPY: Record<InviteErrorCode, { title: string; body: string }> = {
  invite_invalid: {
    title: "This invitation isn't valid",
    body: "The link may be incomplete, or the invitation was withdrawn. Ask the person who invited you to send a new one.",
  },
  invite_expired: {
    title: "This invitation has expired",
    body: "Invitations are valid for 7 days. Ask the person who invited you to send a new one.",
  },
  invite_used: {
    title: "Invitation already accepted",
    body: "This invitation has already been used. If it was you, the workspace is in your workspace menu.",
  },
  already_member: {
    title: "You're already on this team",
    body: "You're already a member of this workspace. Pick it from your workspace menu.",
  },
  invite_email_mismatch: {
    title: "Wrong account",
    body: "This invitation was sent to a different email address than the one you're signed in with. Sign in with the address the invitation was sent to.",
  },
  email_unverified: {
    title: "Verify your email first",
    body: "Before you can join a team, confirm your email address. Open the verification link we emailed you, then open this invitation link again.",
  },
};

function errorCode(err: unknown): InviteErrorCode | null {
  if (!(err instanceof ApiError)) return null;
  const parsed = InviteErrorCode.safeParse((err.detail as { code?: unknown } | undefined)?.code);
  return parsed.success ? parsed.data : null;
}

function InviteContent() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const me = useMe();
  const accept = useAcceptInvite();
  const logout = useLogout();
  const resend = useResendEmailVerification();
  const [resent, setResent] = useState(false);

  const here = `/invite?token=${encodeURIComponent(token)}`;

  if (!token) {
    return (
      <AuthShell title={COPY.invite_invalid.title} sub="This link is missing its invitation token.">
        <p className="text-[12.5px] text-ink-3 m-0">{COPY.invite_invalid.body}</p>
      </AuthShell>
    );
  }

  if (me.isPending) {
    return (
      <AuthShell title="Team invitation" sub="Checking your session…">
        <span className="sr-only" role="status">Loading</span>
      </AuthShell>
    );
  }

  // Signed out, or the accept call found the session had ended.
  const signedOut = me.isError || (accept.error instanceof ApiError && accept.error.status === 401);
  if (signedOut) {
    return (
      <AuthShell
        title="You've been invited to a SnapURL workspace"
        sub="Sign in or create an account with the email address this invitation was sent to, and you'll come straight back here to accept it."
      >
        <div className="flex flex-col gap-2.5">
          <Link
            href={withNext("/login", here)}
            className="inline-flex items-center justify-center h-10 rounded-[var(--radius-sm)] bg-accent text-accent-ink font-semibold text-[13.5px]"
          >
            Sign in to accept
          </Link>
          <Link
            href={withNext("/register", here)}
            className="inline-flex items-center justify-center h-10 rounded-[var(--radius-sm)] border border-line font-semibold text-[13.5px]"
          >
            Create an account
          </Link>
        </div>
      </AuthShell>
    );
  }

  const code = errorCode(accept.error);
  if (code) {
    const copy = COPY[code];
    return (
      <AuthShell title={copy.title} sub={me.data ? `Signed in as ${me.data.email}` : ""}>
        <p className="text-[12.5px] text-ink-2 m-0 mb-4" role="alert">
          {copy.body}
        </p>
        {code === "invite_email_mismatch" ? (
          <Button
            variant="primary"
            size="lg"
            className="justify-center w-full"
            onClick={() => {
              logout();
              router.push(withNext("/login", here));
            }}
          >
            Sign out and use another account
          </Button>
        ) : null}
        {code === "email_unverified" && me.data ? (
          resent ? (
            <p className="text-[12.5px] text-ink-3 m-0" role="status">
              Sent. Check your inbox for the verification link.
            </p>
          ) : (
            <Button
              variant="primary"
              size="lg"
              className="justify-center w-full"
              disabled={resend.isPending}
              onClick={async () => {
                try {
                  await resend.mutateAsync({ email: me.data.email });
                  setResent(true);
                } catch {
                  /* surfaced below */
                }
              }}
            >
              {resend.isPending ? "Sending…" : "Resend verification email"}
            </Button>
          )
        ) : null}
        {code === "invite_used" || code === "already_member" ? (
          <Link href="/links" className="text-[12.5px] text-accent font-semibold">
            Go to SnapURL
          </Link>
        ) : null}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Join this workspace"
      sub={me.data ? `You're signed in as ${me.data.email}.` : "You've been invited to a SnapURL workspace."}
    >
      <p className="text-[12.5px] text-ink-3 m-0 mb-4">
        Accepting adds you to the team with the role you were invited with. Your own workspace stays where it is — switch
        between them from the workspace menu.
      </p>
      {accept.isError ? (
        <p className="text-[12.5px] text-bad m-0 mb-3" role="alert">
          {(accept.error as Error).message}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        className="justify-center w-full"
        disabled={accept.isPending}
        onClick={async () => {
          try {
            await accept.mutateAsync({ token });
            router.push("/links");
          } catch {
            /* rendered from accept.error */
          }
        }}
      >
        {accept.isPending ? "Joining…" : "Accept invitation"}
      </Button>
    </AuthShell>
  );
}
