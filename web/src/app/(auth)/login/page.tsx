"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleButton, hasGoogleAuth } from "@/components/auth/google-button";
import { Button, Field, Input } from "@/components/ui";
import { useLogin, useVerifyTotp } from "@/lib/api/hooks";
import { safeNext, withNext } from "@/lib/safe-next";

const Schema = z.object({
  email: z.string().min(1, "Enter your email address").email("That doesn't look like an email address"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof Schema>;

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
  const next = safeNext(nextParam);
  const login = useLogin();
  const verify = useVerifyTotp();
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(Schema) });

  /* Login can come back as a session OR a TOTP challenge (LoginResult union). We
     hold the challenge token here and swap the form for a code-entry step; only a
     verified session navigates. Without this, a 2FA-enabled account could not
     finish signing in (issue #377). */
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await login.mutateAsync(values);
      if ("challenge" in result) {
        setChallengeToken(result.challengeToken);
        return;
      }
      router.push(next);
    } catch {
      /* surfaced from login.error */
    }
  });

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setCodeError(null);
    try {
      await verify.mutateAsync({ challengeToken, code });
      router.push(next);
    } catch (err) {
      setCodeError((err as Error).message || "That code isn't right.");
    }
  }

  if (challengeToken) {
    return (
      <AuthShell title="Two-factor authentication" sub="Enter the 6-digit code from your authenticator app.">
        <form onSubmit={submitCode} className="flex flex-col gap-3.5">
          <Field label="Authentication code" error={codeError ?? undefined}>
            <Input
              value={code}
              onChange={(e) => { setCode(e.target.value); setCodeError(null); }}
              autoComplete="one-time-code"
              inputMode="numeric"
              placeholder="123456"
              aria-label="Authentication code"
              autoFocus
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="justify-center" disabled={verify.isPending || code.length < 6}>
            {verify.isPending ? "Verifying…" : "Verify"}
          </Button>
          <button
            type="button"
            onClick={() => { setChallengeToken(null); setCode(""); setCodeError(null); }}
            className="text-[12.5px] text-ink-3 text-center bg-transparent border-0 cursor-pointer"
          >
            Back to sign in
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Welcome back" sub="Sign in to your SnapURL workspace.">
      {hasGoogleAuth ? (
        <>
          <GoogleButton text="signin_with" />
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
