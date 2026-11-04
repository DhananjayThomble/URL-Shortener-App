"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button, Field, Input } from "@/components/ui";
import type { ApiError } from "@/lib/api/client";
import { useVerifyTotp } from "@/lib/api/hooks";
import {
  canSubmitCode,
  codeErrorMessage,
  codeInputProps,
  normaliseCode,
  sanitiseTyping,
  type CodeMode,
} from "@/lib/two-factor-code";

// Nothing focused (the submit button was clicked, then disabled while pending):
// the next Enter would go nowhere.
const focusIsLost = () => !document.activeElement || document.activeElement === document.body;

/**
 * The TOTP / recovery-code step shared by /login and /register, for a password
 * challenge or a Google sign-in challenge alike. The challenge token lives in
 * the caller's memory only (never URL or storage); a verified session
 * navigates to `next`.
 */
export function TwoFactorStep({
  challengeToken,
  next,
  onBack,
}: {
  challengeToken: string;
  next: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const verify = useVerifyTotp();
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

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (verify.isPending || !canSubmitCode(mode, code)) return;
    setCodeError(null);
    try {
      await verify.mutateAsync({ challengeToken, code: normaliseCode(mode, code) });
      router.push(next);
    } catch (err) {
      setCodeError(codeErrorMessage(mode, (err as ApiError).status, (err as Error).message ?? ""));
      // #778 — hand focus back to the code field.
      if (focusIsLost()) {
        codeRef.current?.focus();
        codeRef.current?.select();
      }
    }
  }

  function switchMode() {
    setMode((m) => (m === "totp" ? "recovery" : "totp"));
    setCode("");
    setCodeError(null);
  }

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
          onClick={onBack}
          className="text-[12.5px] text-ink-3 text-center bg-transparent border-0 cursor-pointer"
        >
          Back to sign in
        </button>
      </form>
    </AuthShell>
  );
}
