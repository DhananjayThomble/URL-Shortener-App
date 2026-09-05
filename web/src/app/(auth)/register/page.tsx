"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleButton, hasGoogleAuth } from "@/components/auth/google-button";
import { Button, Field, Input } from "@/components/ui";
import { useRegister } from "@/lib/api/hooks";

const Schema = z.object({
  name: z.string().min(2, "What should we call you?"),
  email: z.string().min(1, "Enter your email address").email("That doesn't look like an email address"),
  // Must match RegisterInput in @snapurl/contract. When this said 8, an
  // 8-character password passed client validation and then failed with a 400
  // from the API — the user saw a server error for something the form had
  // already told them was fine.
  password: z.string().min(12, "Use at least 12 characters — length beats complexity"),
});
type Values = z.infer<typeof Schema>;

export default function RegisterPage() {
  const router = useRouter();
  const signup = useRegister();
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(Schema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await signup.mutateAsync(values);
      router.push("/links");
    } catch {
      /* surfaced from signup.error */
    }
  });

  return (
    <AuthShell title="Start free" sub="No card. Links, QR codes and edits are never metered.">
      {hasGoogleAuth ? (
        <>
          <GoogleButton text="signup_with" />
          <div className="flex items-center gap-3 my-4">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11.5px] text-ink-3">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <Field label="Name" error={formState.errors.name?.message}>
          <Input {...register("name")} autoComplete="name" placeholder="Priya Raman" />
        </Field>
        <Field label="Email" error={formState.errors.email?.message}>
          <Input {...register("email")} type="email" autoComplete="email" placeholder="you@company.com" />
        </Field>
        <Field label="Password" help="At least 12 characters." error={formState.errors.password?.message}>
          <Input {...register("password")} type="password" autoComplete="new-password" placeholder="••••••••" />
        </Field>
        {signup.isError ? <p className="text-[12.5px] text-bad m-0">{(signup.error as Error).message}</p> : null}
        <Button type="submit" variant="primary" size="lg" className="justify-center" disabled={signup.isPending}>
          {signup.isPending ? "Creating your workspace…" : "Create account"}
        </Button>
        <p className="text-[12.5px] text-ink-3 text-center m-0">
          Already have an account?{" "}
          <Link href="/login" className="text-accent font-semibold">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
