"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PasswordResetConfirmInput } from "@snapurl/contract";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button, Field, Input } from "@/components/ui";
import { useConfirmPasswordReset } from "@/lib/api/hooks";

const Schema = PasswordResetConfirmInput.pick({ password: true });
type Values = z.infer<typeof Schema>;

// This route has no dynamic segment (unlike /p/[slug]), so Next tries to
// statically prerender it — and useSearchParams() requires a Suspense
// boundary during prerender or the build fails. The fallback never actually
// shows in practice: the client bails out of the static shell immediately.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const confirmReset = useConfirmPasswordReset();
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(Schema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await confirmReset.mutateAsync({ token, password: values.password });
      router.push("/login");
    } catch {
      /* surfaced from confirmReset.error */
    }
  });

  // No token at all (someone navigated here directly) — don't show a form
  // that can only fail; send them to request a fresh link.
  if (!token) {
    return (
      <AuthShell title="Invalid reset link" sub="This link is missing its reset token.">
        <p className="text-[12.5px] text-ink-3 text-center m-0">
          <Link href="/forgot-password" className="text-accent font-semibold">
            Request a new reset link
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" sub="Enter a new password for your account.">
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <Field label="New password" help="At least 12 characters." error={formState.errors.password?.message}>
          <Input {...register("password")} type="password" autoComplete="new-password" placeholder="••••••••" autoFocus />
        </Field>
        {confirmReset.isError ? (
          <div className="flex flex-col gap-2">
            <p className="text-[12.5px] text-bad m-0">{(confirmReset.error as Error).message}</p>
            <p className="text-[12.5px] text-ink-3 m-0">
              <Link href="/forgot-password" className="text-accent font-semibold">
                Request a new reset link
              </Link>
            </p>
          </div>
        ) : null}
        <Button type="submit" variant="primary" size="lg" className="justify-center" disabled={confirmReset.isPending}>
          {confirmReset.isPending ? "Resetting…" : "Reset password"}
        </Button>
      </form>
    </AuthShell>
  );
}
