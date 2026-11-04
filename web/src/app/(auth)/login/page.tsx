"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthShell, SessionCheck } from "@/components/auth/auth-shell";
import { GoogleButton, hasGoogleAuth } from "@/components/auth/google-button";
import { TwoFactorStep } from "@/components/auth/two-factor-step";
import { Button, Field, Input } from "@/components/ui";
import { useLogin, useRedirectIfSignedIn } from "@/lib/api/hooks";
import { signedInTarget, withNext } from "@/lib/safe-next";

const Schema = z.object({
  email: z.string().min(1, "Enter your email address").email("That doesn't look like an email address"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof Schema>;

// Nothing focused (the submit button was clicked, then disabled while pending, or
// the browser never focuses buttons on click): the next Enter would go nowhere.
const focusIsLost = () => !document.activeElement || document.activeElement === document.body;

// useSearchParams (for ?next=, #668) needs a Suspense boundary during static
// prerender, same as reset-password/page.tsx.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  // Where to go once signed in — e.g. back to an /invite link (#668). Only a
  // same-origin path is honoured; see safeNext.
  const nextParam = useSearchParams().get("next");
  const next = signedInTarget(nextParam);
  const login = useLogin();
  // #777 — already signed in? Verify the session and move on to `next`.
  const { checking } = useRedirectIfSignedIn(nextParam);
  const { register, handleSubmit, formState, setFocus } = useForm<Values>({ resolver: zodResolver(Schema) });

  /* Login (or Google sign-in) can come back as a session OR a TOTP challenge. The
     token is held in memory only; the form swaps for the shared code-entry step
     and only a verified session navigates (issue #377). */
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await login.mutateAsync(values);
      if ("challenge" in result) {
        setChallengeToken(result.challengeToken);
        return;
      }
      router.push(next);
    } catch {
      /* surfaced from login.error. #778 — a clicked submit button is disabled
         while the request runs, which drops focus to <body>; put it back on the
         password (text selected) so Enter and typing work without another click. */
      if (focusIsLost()) setFocus("password", { shouldSelect: true });
    }
  });

  if (checking) {
    return (
      <AuthShell title="Welcome back" sub="Checking your session…">
        <SessionCheck />
      </AuthShell>
    );
  }

  if (challengeToken) {
    return <TwoFactorStep challengeToken={challengeToken} next={next} onBack={() => setChallengeToken(null)} />;
  }

  return (
    <AuthShell title="Welcome back" sub="Sign in to your SnapURL workspace.">
      {hasGoogleAuth ? (
        <>
          <GoogleButton text="signin_with" next={nextParam} onChallenge={setChallengeToken} />
          <div className="flex items-center gap-3 my-4">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11.5px] text-ink-3">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <Field label="Email" error={formState.errors.email?.message}>
          <Input {...register("email")} type="email" autoComplete="email" placeholder="you@company.com" />
        </Field>
        <Field label="Password" error={formState.errors.password?.message}>
          <Input {...register("password")} type="password" autoComplete="current-password" placeholder="••••••••" />
        </Field>
        <Link href="/forgot-password" className="text-[12.5px] text-accent font-semibold self-end -mt-1.5">
          Forgot password?
        </Link>
        {login.isError ? <p className="text-[12.5px] text-bad m-0">{(login.error as Error).message}</p> : null}
        <Button type="submit" variant="primary" size="lg" className="justify-center" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-[12.5px] text-ink-3 text-center m-0">
          New here?{" "}
          <Link href={withNext("/register", nextParam)} className="text-accent font-semibold">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
