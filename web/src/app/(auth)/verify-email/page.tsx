"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button, Field, Input } from "@/components/ui";
import { useResendEmailVerification, useVerifyEmail } from "@/lib/api/hooks";

// No dynamic segment on this route, so Next tries to statically prerender it —
// useSearchParams() requires a Suspense boundary during prerender or the
// build fails (same reason as reset-password/page.tsx).
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const token = useSearchParams().get("token") ?? "";
  const verify = useVerifyEmail();
  const resend = useResendEmailVerification();
  // The verify call must fire exactly once per token, not once per render —
  // mutate() inside an effect with no guard re-fires on every re-render
  // useMutation itself causes (isPending flipping, etc).
  const attempted = useRef(false);

  const [resendEmail, setResendEmail] = useState("");
  const [resendSent, setResendSent] = useState(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    verify.mutate({ token });
    // verify is a useMutation instance — stable enough across renders for
    // this effect's purpose; only `token` should re-trigger it, and the
    // attempted guard above already blocks a second real call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function onResend(e: React.FormEvent) {
    e.preventDefault();
    try {
      await resend.mutateAsync({ email: resendEmail });
      setResendSent(true);
    } catch {
      /* surfaced from resend.error */
    }
  }

  if (!token) {
    return (
      <AuthShell title="Invalid verification link" sub="This link is missing its verification token.">
        <p className="text-[12.5px] text-ink-3 text-center m-0">
          <Link href="/login" className="text-accent font-semibold">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  if (verify.isPending || verify.isIdle) {
    return (
      <AuthShell title="Verifying your email…" sub="One moment.">
        <p className="text-[13.5px] text-ink-2 text-center m-0">Checking your verification link.</p>
      </AuthShell>
    );
  }

  if (verify.isSuccess) {
    return (
      <AuthShell title="Email verified" sub="Your email address has been confirmed.">
        <p className="text-[12.5px] text-ink-3 text-center m-0">
          <Link href="/login" className="text-accent font-semibold">
            Continue to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  // verify.isError — the link was invalid or has expired. Offer a resend
  // rather than dead-ending; resend gives the same response for any email (no
  // enumeration), same as password-reset request, so the confirmation below
  // must not vary with whether the address exists.
  return (
    <AuthShell title="Verification failed" sub={(verify.error as Error).message || "That link is invalid or has expired."}>
      {resendSent ? (
        <p className="text-[13.5px] text-ink-2 text-center m-0">
          If that address needs verifying, we&apos;ve sent a new link.
        </p>
      ) : (
        <form onSubmit={onResend} className="flex flex-col gap-3.5">
          <Field label="Email">
            <Input
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
            />
          </Field>
          {resend.isError ? <p className="text-[12.5px] text-bad m-0">{(resend.error as Error).message}</p> : null}
          <Button type="submit" variant="primary" size="lg" className="justify-center" disabled={resend.isPending || !resendEmail}>
            {resend.isPending ? "Sending…" : "Resend verification email"}
          </Button>
        </form>
      )}
      <p className="text-[12.5px] text-ink-3 text-center m-0 mt-3">
        <Link href="/login" className="text-accent font-semibold">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
