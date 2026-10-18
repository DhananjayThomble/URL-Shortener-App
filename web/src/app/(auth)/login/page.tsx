"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthShell, SessionCheck } from "@/components/auth/auth-shell";
import { GoogleButton, hasGoogleAuth } from "@/components/auth/google-button";
import { Button, Field, Input } from "@/components/ui";
import type { ApiError } from "@/lib/api/client";
import { useLogin, useRedirectIfSignedIn, useVerifyTotp } from "@/lib/api/hooks";
import { signedInTarget, withNext } from "@/lib/safe-next";
import {
  canSubmitCode,
  codeErrorMessage,
  codeInputProps,
  normaliseCode,
  sanitiseTyping,
  type CodeMode,
} from "@/lib/two-factor-code";

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
  const next = signedInTarget(nextParam);
  const login = useLogin();
  const verify = useVerifyTotp();
  // #777 — already signed in? Verify the session and move on to `next`.
  const { checking } = useRedirectIfSignedIn(nextParam);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(Schema) });

  /* Login can come back as a session OR a TOTP challenge (LoginResult union). We
     hold the challenge token here and swap the form for a code-entry step; only a
     verified session navigates. Without this, a 2FA-enabled account could not
     finish signing in (issue #377). */
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  /* #776 — the same step takes a TOTP or a single-use recovery code (the API
     tries both). Recovery codes are letters, so that mode swaps the numeric
     keypad for a text keyboard; see lib/two-factor-code. */
  const [mode, setMode] = useState<CodeMode>("totp");
  const codeRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    // Focus follows a mode switch (autoFocus only covers the first mount).
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    codeRef.current?.focus();
  }, [mode]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await login.mutateAsync(values);
      if ("challenge" in result) {
        setMode("totp");
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
    if (!challengeToken || verify.isPending || !canSubmitCode(mode, code)) return;
    setCodeError(null);
    try {
      await verify.mutateAsync({ challengeToken, code: normaliseCode(mode, code) });
      router.push(next);
    } catch (err) {
      setCodeError(codeErrorMessage(mode, (err as ApiError).status, (err as Error).message ?? ""));
    }
  }

  function switchMode() {
    setMode((m) => (m === "totp" ? "recovery" : "totp"));
    setCode("");
    setCodeError(null);
  }

  if (checking) {
    return (
      <AuthShell title="Welcome back" sub="Checking your session…">
        <SessionCheck />
      </AuthShell>
    );
  }

  if (challengeToken) {
    const input = codeInputProps(mode);
    const recovery = mode === "recovery";
    return (
      <AuthShell
        title={recovery ? "Use a recovery code" : "Two-factor authentication"}
        sub={
          recovery
            ? "Enter one of the recovery codes you saved when you turned on two-factor authentication. Each code works once."
            : "Enter the 6-digit code from your authenticator app. Lost access to it? Use one of your recovery codes instead."
        }
      >
        <form onSubmit={submitCode} className="flex flex-col gap-3.5">
          <Field
            label={input.label}
            error={codeError ?? undefined}
            help={recovery ? "Dashes, spaces and capitals don't matter." : undefined}
          >
            <Input
              // A new element per mode so the browser re-reads inputmode and
              // drops any autofill suggestion meant for the other kind of code.
              key={mode}
              ref={codeRef}
              value={code}
              onChange={(e) => { setCode(sanitiseTyping(mode, e.target.value)); setCodeError(null); }}
              name={recovery ? "recovery-code" : "one-time-code"}
              autoComplete={input.autoComplete}
              inputMode={input.inputMode}
              autoCapitalize={input.autoCapitalize}
              autoCorrect={input.autoCorrect}
              spellCheck={input.spellCheck}
              pattern={input.pattern}
              maxLength={input.maxLength}
              placeholder={input.placeholder}
              aria-label={input.label}
              autoFocus
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="justify-center" disabled={verify.isPending || !canSubmitCode(mode, code)}>
            {verify.isPending ? "Verifying…" : "Verify"}
          </Button>
          <button
            type="button"
            onClick={switchMode}
            className="text-[12.5px] text-accent font-semibold text-center bg-transparent border-0 cursor-pointer"
          >
            {recovery ? "Use your authenticator app instead" : "Use a recovery code"}
          </button>
          <button
            type="button"
            onClick={() => { setChallengeToken(null); setCode(""); setCodeError(null); setMode("totp"); }}
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
          <GoogleButton text="signin_with" next={nextParam} />
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
