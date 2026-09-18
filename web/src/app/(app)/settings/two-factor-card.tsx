"use client";

import { useState } from "react";
import { QrPreview } from "@/components/qr/qr-preview";
import { Button, Card, CardBody, CardHeader, Chip, Field, Input, Skeleton } from "@/components/ui";
import { useDisableTotp, useEnableTotp, useMe, useMembers, useSetupTotp } from "@/lib/api/hooks";
import type { TotpSetup } from "@/lib/api/types";

/* G6 / #458 — the settings surface for two-factor.
 *
 * The hooks (useSetupTotp / useEnableTotp / useDisableTotp) and their endpoints
 * already worked end to end; what was missing was any component that called
 * them. The team page already renders each member's `twoFactor` state as a
 * chip, but there was no way for a user to turn their own on or off.
 *
 * Current status is derived, not invented: `useMe()` gives the signed-in user's
 * id and `useMembers()` carries `twoFactor` per member (packages/contract
 * Member.twoFactor). That is the same source the team page reads, so no new
 * `/auth/me` field is added — the issue explicitly asked to check what already
 * exists first. */

type Phase = "idle" | "enrolling" | "showing-codes" | "disabling";

export function TwoFactorCard() {
  const me = useMe();
  const members = useMembers();
  const setup = useSetupTotp();
  const enable = useEnableTotp();
  const disable = useDisableTotp();

  const [phase, setPhase] = useState<Phase>("idle");
  const [enrolment, setEnrolment] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const loading = me.isLoading || members.isLoading;
  // Member.id is the *membership* id, not the user id, so the two never match
  // on id. Email is exposed by both AuthUser and Member (packages/contract) and
  // is the stable link between "who I am" and "my row in the members list".
  const currentMember = me.data
    ? members.data?.find((x) => x.email.toLowerCase() === me.data!.email.toLowerCase())
    : undefined;
  const enabled = currentMember?.twoFactor ?? false;

  function reset() {
    setPhase("idle");
    setEnrolment(null);
    setCode("");
    setPassword("");
    setProblem(null);
  }

  async function beginEnrol() {
    setProblem(null);
    try {
      const result = await setup.mutateAsync();
      setEnrolment(result);
      setPhase("enrolling");
    } catch (err) {
      setProblem((err as Error).message);
    }
  }

  async function confirmEnrol() {
    setProblem(null);
    try {
      const { recoveryCodes: codes } = await enable.mutateAsync({ code });
      setRecoveryCodes(codes);
      setPhase("showing-codes");
      setCode("");
      setEnrolment(null);
    } catch (err) {
      setProblem((err as Error).message);
    }
  }

  async function confirmDisable() {
    setProblem(null);
    try {
      await disable.mutateAsync({ password });
      reset();
    } catch (err) {
      setProblem((err as Error).message);
    }
  }

  return (
    <Card id="two-factor">
      <CardHeader
        title="Two-factor authentication"
        right={
          loading ? undefined : (
            <Chip tone={enabled ? "good" : "warn"} dot>
              {enabled ? "On" : "Off"}
            </Chip>
          )
        }
      />
      <CardBody className="flex flex-col gap-3.5">
        {loading ? (
          <Skeleton className="h-[120px]" />
        ) : phase === "showing-codes" ? (
          <>
            <p className="m-0 text-[13px] text-ink-2 leading-[1.55]">
              Two-factor authentication is on. Save these ten recovery codes somewhere safe — each works once, and
              they are the only way back in if you lose your authenticator. They are shown now and never again.
            </p>
            <ul className="grid grid-cols-2 gap-1.5 m-0 p-0 list-none font-mono text-[12.5px] text-ink">
              {recoveryCodes.map((c) => (
                <li key={c} className="px-2.5 py-1.5 bg-surface-3 rounded-[var(--radius-sm)]">
                  {c}
                </li>
              ))}
            </ul>
            <Button variant="primary" className="self-start" onClick={reset}>
              I&apos;ve saved my codes
            </Button>
          </>
        ) : enabled ? (
          phase === "disabling" ? (
            <>
              <p className="m-0 text-[13px] text-ink-2 leading-[1.55]">
                Enter your password to turn off two-factor authentication.
              </p>
              <Field label="Password" error={problem ?? undefined}>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button
                  variant="danger"
                  onClick={confirmDisable}
                  disabled={!password || disable.isPending}
                >
                  {disable.isPending ? "Turning off…" : "Turn off two-factor"}
                </Button>
                <Button onClick={reset} disabled={disable.isPending}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="m-0 text-[13px] text-ink-2 leading-[1.55]">
                Your account is protected by an authenticator app. You&apos;ll be asked for a code each time you sign
                in.
              </p>
              <Button variant="danger" className="self-start" onClick={() => setPhase("disabling")}>
                Turn off two-factor
              </Button>
            </>
          )
        ) : phase === "enrolling" && enrolment ? (
          <>
            <p className="m-0 text-[13px] text-ink-2 leading-[1.55]">
              Scan this with an authenticator app (or enter the secret by hand), then type the six-digit code it shows
              to finish.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div className="shrink-0 bg-white p-2.5 rounded-[var(--radius-sm)]">
                <QrPreview value={enrolment.otpauthUri} size={160} logo={false} />
              </div>
              <div className="flex flex-col gap-3.5 flex-1 w-full">
                <Field label="Secret" help="Enter this if you can't scan the code.">
                  <Input readOnly value={enrolment.secret} className="font-mono text-[12.5px]" />
                </Field>
                <Field label="Authentication code" error={problem ?? undefined}>
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className="font-mono tracking-[0.2em]"
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    onClick={confirmEnrol}
                    disabled={code.length !== 6 || enable.isPending}
                  >
                    {enable.isPending ? "Verifying…" : "Turn on two-factor"}
                  </Button>
                  <Button onClick={reset} disabled={enable.isPending}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="m-0 text-[13px] text-ink-2 leading-[1.55]">
              Add a second step to sign-in with an authenticator app, so a stolen password isn&apos;t enough to get
              into your account.
            </p>
            {problem ? <span className="text-[11.5px] text-bad leading-[1.5]">{problem}</span> : null}
            <Button
              variant="primary"
              className="self-start"
              onClick={beginEnrol}
              disabled={setup.isPending}
            >
              {setup.isPending ? "Starting…" : "Set up two-factor"}
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}
