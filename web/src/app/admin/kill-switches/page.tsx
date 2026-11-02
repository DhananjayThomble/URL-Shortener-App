"use client";

import { useMemo, useState } from "react";
import {
  KILL_SWITCH_KEYS,
  KILL_SWITCH_LABELS,
  type KillSwitchesPatchBody,
  type KillSwitchesView,
  type KillSwitchKey,
} from "@snapurl/contract";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  ErrorState,
  Field,
  Input,
  Skeleton,
  Toggle,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useAdminAudit, useAdminKillSwitches, useAdminUpdateKillSwitches } from "@/lib/api/hooks";

/* #1020 — runtime KILL SWITCHES (part of the admin panel).

   One toggle per cost-incurring feature, its caps editable, and a REQUIRED
   reason on every change (the API refuses a reason-less PATCH). The change
   history is read from the platform audit log (action
   admin.settings.killSwitches). The header shows the effective state and the
   runtime cache TTL — a change takes effect within that window with no
   redeploy. Billing and custom domains ship OFF; turning them on is explicit.
   The webhook path is never switched off: there is no switch for it, so a
   payment the provider already took is always recorded. Auth-critical mail
   (verification, password reset) bypasses the email.outbound OFF switch but
   stays capped. */

export default function AdminKillSwitchesPage() {
  const { data, isPending, isError, refetch } = useAdminKillSwitches();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-1">Kill switches</h1>
        <p className="mt-1 text-sm text-ink-3">
          Switch off any feature that costs money, or could be abused for money, at runtime with no redeploy. Billing
          and custom domains ship <strong>off</strong>. A switched-off feature refuses new actions with a named reason
          and changes nothing. <strong>Verified payment webhooks are never switched off</strong> &mdash; a payment the
          provider already took is always recorded. <strong>Auth-critical mail</strong> (email verification and
          password reset) still sends while outbound email is off, but stays within the caps.
        </p>
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <ErrorState message="Could not load the kill switches." onRetry={() => refetch()} />
      ) : (
        <KillSwitchForm view={data!} />
      )}

      <ChangeHistory />
    </div>
  );
}

/** A number input bound to a numeric string, surfaced as a labelled field. */
function CapInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <Input inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} className="w-32" />
    </Field>
  );
}

function KillSwitchForm({ view }: { view: KillSwitchesView }) {
  const toast = useToast();
  const update = useAdminUpdateKillSwitches();
  const { values, defaults } = view;

  // Local editable copies, seeded from the effective values.
  const [on, setOn] = useState<Record<KillSwitchKey, boolean>>(
    () => Object.fromEntries(KILL_SWITCH_KEYS.map((k) => [k, values[k].on])) as Record<KillSwitchKey, boolean>,
  );
  const [domainTotal, setDomainTotal] = useState(String(values["customDomains.create"].domainCaps?.totalMax ?? ""));
  const [domainPerDay, setDomainPerDay] = useState(String(values["customDomains.create"].domainCaps?.perDay ?? ""));
  const [emailPerHour, setEmailPerHour] = useState(String(values["email.outbound"].emailCaps?.perHour ?? ""));
  const [emailPerDay, setEmailPerDay] = useState(String(values["email.outbound"].emailCaps?.perDay ?? ""));
  const [sampleRate, setSampleRate] = useState(String(values.errorTracking.errorCaps?.sampleRate ?? ""));
  const [reason, setReason] = useState("");

  const ttlSeconds = Math.round(view.cacheTtlMs / 1000);

  // The diff: only the switches/caps the admin actually changed.
  const patch = useMemo<Omit<KillSwitchesPatchBody, "reason">>(() => {
    const p: Record<string, unknown> = {};
    for (const key of KILL_SWITCH_KEYS) {
      const change: Record<string, unknown> = {};
      if (on[key] !== values[key].on) change.on = on[key];
      p[key] = change;
    }
    // Caps (only when valid + changed).
    const dTotal = Number(domainTotal);
    const dPerDay = Number(domainPerDay);
    if (
      Number.isInteger(dTotal) &&
      Number.isInteger(dPerDay) &&
      (dTotal !== values["customDomains.create"].domainCaps?.totalMax ||
        dPerDay !== values["customDomains.create"].domainCaps?.perDay)
    ) {
      (p["customDomains.create"] as Record<string, unknown>).domainCaps = { totalMax: dTotal, perDay: dPerDay };
    }
    const ePerHour = Number(emailPerHour);
    const ePerDay = Number(emailPerDay);
    if (
      Number.isInteger(ePerHour) &&
      Number.isInteger(ePerDay) &&
      (ePerHour !== values["email.outbound"].emailCaps?.perHour ||
        ePerDay !== values["email.outbound"].emailCaps?.perDay)
    ) {
      (p["email.outbound"] as Record<string, unknown>).emailCaps = { perHour: ePerHour, perDay: ePerDay };
    }
    const rate = Number(sampleRate);
    if (rate >= 0 && rate <= 1 && rate !== values.errorTracking.errorCaps?.sampleRate) {
      (p.errorTracking as Record<string, unknown>).errorCaps = { sampleRate: rate };
    }
    // Drop keys with no change so the "at least one" refine is accurate.
    for (const key of KILL_SWITCH_KEYS) {
      if (Object.keys(p[key] as object).length === 0) delete p[key];
    }
    return p as Omit<KillSwitchesPatchBody, "reason">;
  }, [on, domainTotal, domainPerDay, emailPerHour, emailPerDay, sampleRate, values]);

  const dirty = Object.keys(patch).length > 0;
  const canSave = dirty && reason.trim().length > 0 && !update.isPending;

  const onSave = () => {
    if (!canSave) return;
    update.mutate({ ...patch, reason: reason.trim() } as KillSwitchesPatchBody, {
      onSuccess: () => {
        toast.show({ message: "Kill switches saved." });
        setReason("");
      },
      onError: (e) =>
        toast.show({ message: e instanceof Error ? e.message : "Could not save.", tone: "error" }),
    });
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <Card>
        <CardHeader title="Switches" />
        <CardBody className="space-y-3">
          <p className="text-[11.5px] text-ink-3">
            Effective now · refreshes within ~{ttlSeconds}s of a change.{" "}
            {view.updatedBy ? (
              <>
                Last changed by {view.updatedBy}
                {view.updatedAt ? ` · ${new Date(view.updatedAt).toLocaleString()}` : ""}.
              </>
            ) : (
              <>Running on defaults · never changed.</>
            )}
          </p>
          <div className="space-y-2">
            {KILL_SWITCH_KEYS.map((key) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <Toggle
                  checked={on[key]}
                  onChange={(v) => setOn((s) => ({ ...s, [key]: v }))}
                  title={KILL_SWITCH_LABELS[key]}
                  description={on[key] ? "On" : "Off (engaged)"}
                />
                <Chip tone="default">Default: {defaults[key].on ? "on" : "off"}</Chip>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Hard caps" />
        <CardBody className="space-y-4">
          <div>
            <p className="text-sm font-medium text-ink-2">Custom domains</p>
            <div className="mt-1 flex flex-wrap gap-4">
              <CapInput label="Total (platform-wide)" value={domainTotal} onChange={setDomainTotal} />
              <CapInput label="New per day" value={domainPerDay} onChange={setDomainPerDay} />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-ink-2">Outbound email</p>
            <p className="text-[11.5px] text-ink-3">
              Auth-critical mail (verification, password reset) is counted against these caps even when the switch is
              off.
            </p>
            <div className="mt-1 flex flex-wrap gap-4">
              <CapInput label="Per hour" value={emailPerHour} onChange={setEmailPerHour} />
              <CapInput label="Per day" value={emailPerDay} onChange={setEmailPerDay} />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-ink-2">Error tracking</p>
            <div className="mt-1 flex flex-wrap gap-4">
              <CapInput label="Sample rate (0&ndash;1)" value={sampleRate} onChange={setSampleRate} />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <Field label="Reason for this change (required)">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. abuse wave on checkout — paused while we investigate"
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!canSave}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
            {!dirty ? (
              <span className="text-xs text-ink-3">No changes to save.</span>
            ) : reason.trim().length === 0 ? (
              <span className="text-xs text-ink-3">A reason is required.</span>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </form>
  );
}

/** The change history, read from the platform audit log (every kill-switch
 *  change records a row with action admin.settings.killSwitches). */
function ChangeHistory() {
  const { data, isPending } = useAdminAudit({ action: "admin.settings.killSwitches" });

  return (
    <Card>
      <CardHeader title="Change history" />
      <CardBody>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : !data || data.rows.length === 0 ? (
          <p className="text-sm text-ink-3">No changes yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-ink-2">
                <span className="text-ink-3">{new Date(row.at).toLocaleString()}</span>
                <span>&middot;</span>
                <span>{row.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
