"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button, Field, Input } from "@/components/ui";
import { useRequestPasswordReset } from "@/lib/api/hooks";

const Schema = z.object({
  email: z.string().min(1, "Enter your email address").email("That doesn't look like an email address"),
});
type Values = z.infer<typeof Schema>;

export default function ForgotPasswordPage() {
  const requestReset = useRequestPasswordReset();
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(Schema) });
  // Set once the request succeeds; the confirmation below replaces the form
  // and never varies with whether the email actually has an account — the API
  // gives the same response either way, and the UI must not become the
  // enumeration oracle the API deliberately isn't.
  const [sent, setSent] = useState(false);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await requestReset.mutateAsync(values);
      setSent(true);
    } catch {
      /* surfaced from requestReset.error */
    }
  });

  if (sent) {
    return (
      <AuthShell title="Check your email" sub="If an account exists for that address, we've sent a link to reset your password.">
        <p className="text-[12.5px] text-ink-3 text-center m-0">
          <Link href="/login" className="text-accent font-semibold">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot your password?" sub="Enter your email and we'll send you a reset link.">
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <Field label="Email" error={formState.errors.email?.message}>
          <Input {...register("email")} type="email" autoComplete="email" placeholder="you@company.com" autoFocus />
        </Field>
        {requestReset.isError ? (
          <p className="text-[12.5px] text-bad m-0">{(requestReset.error as Error).message}</p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" className="justify-center" disabled={requestReset.isPending}>
          {requestReset.isPending ? "Sending…" : "Send reset link"}
        </Button>
        <p className="text-[12.5px] text-ink-3 text-center m-0">
          <Link href="/login" className="text-accent font-semibold">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
