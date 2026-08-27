"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button, Field, Input } from "@/components/ui";
import { useLogin } from "@/lib/api/hooks";

const Schema = z.object({
  email: z.string().min(1, "Enter your email address").email("That doesn't look like an email address"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof Schema>;

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(Schema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      router.push("/links");
    } catch {
      /* surfaced from login.error */
    }
  });

  return (
    <AuthShell title="Welcome back" sub="Sign in to your SnapURL workspace.">
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <Field label="Email" error={formState.errors.email?.message}>
          <Input {...register("email")} type="email" autoComplete="email" placeholder="you@company.com" />
        </Field>
        <Field label="Password" error={formState.errors.password?.message}>
          <Input {...register("password")} type="password" autoComplete="current-password" placeholder="••••••••" />
        </Field>
        {login.isError ? <p className="text-[12.5px] text-bad m-0">{(login.error as Error).message}</p> : null}
        <Button type="submit" variant="primary" size="lg" className="justify-center" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-[12.5px] text-ink-3 text-center m-0">
          New here?{" "}
          <Link href="/register" className="text-accent font-semibold">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
