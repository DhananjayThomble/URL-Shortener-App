"use client";

import { useMemo, useState } from "react";
import type { PlatformSettings, PlatformSettingsInput, SignupMode } from "@snapurl/contract";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  ErrorState,
  Field,
  Input,
  Segmented,
  Skeleton,
  Toggle,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useAdminSettings, useAdminUpdateSettings } from "@/lib/api/hooks";

/* #972 — runtime platform settings (admin panel 5/7).

   One page, one panel per setting. Each panel shows the current value, the
   default (the env-configured value for the rate limit), and who last changed
   it. Saving sends ONLY the settings whose value the admin actually changed —
   an empty diff is disabled, so a no-op save never writes an audit row. The API
   applies the change within its runtime cache window, so it takes effect
   without a redeploy. Reaching this page means AdminGate confirmed the caller
   is a platform admin; the API re-checks on every request behind it. */

const SIGNUP_OPTIONS: { value: SignupMode; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "invite_only", label: "Invite only" },
  { value: "closed", label: "Closed" },
];

const BANNER_LEVELS = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
] as const;

export default function AdminSettingsPage() {
  const { data, isPending, isError, refetch } = useAdminSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-1">Platform settings</h1>
        <p className="mt-1 text-sm text-ink-3">
          Change how the platform behaves without a redeploy. Each change is recorded in the admin audit log and takes
          effect within about a minute. Secrets, database, JWT and AWS infrastructure settings live in SSM and are not
          here.
        </p>
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <ErrorState message="Could not load the platform settings." onRetry={() => refetch()} />
      ) : (
        <SettingsForm settings={data!} />
      )}
    </div>
  );
}

/** "last changed by" line for a setting key, or a note that it is on its default. */
function Provenance({ settings, settingKey }: { settings: PlatformSettings; settingKey: string }) {
  const meta = settings.meta[settingKey];
  if (!meta || !meta.updatedAt || !meta.updatedBy) {
    return <span className="text-[11px] text-ink-3">Default · never changed</span>;
  }
  return (
    <span className="text-[11px] text-ink-3">
      Last changed by {meta.updatedBy} · {new Date(meta.updatedAt).toLocaleString()}
    </span>
  );
}

function SettingsForm({ settings }: { settings: PlatformSettings }) {
  const toast = useToast();
  const update = useAdminUpdateSettings();
  const { values, defaults } = settings;

  // Local editable copies, seeded from the current effective values.
  const [signupMode, setSignupMode] = useState<SignupMode>(values.signupMode);
  const [limit, setLimit] = useState(String(values.rateLimit.limit));
  const [ttl, setTtl] = useState(String(values.rateLimit.ttlSeconds));
  const [slugsText, setSlugsText] = useState(values.reservedSlugs.join(", "));
  const [banner, setBanner] = useState(values.banner.message);
  const [bannerLevel, setBannerLevel] = useState<(typeof BANNER_LEVELS)[number]["value"]>(values.banner.level);
  const [flags, setFlags] = useState<Record<string, boolean>>({ ...values.featureFlags });
  const [newFlag, setNewFlag] = useState("");

  const parsedSlugs = useMemo(
    () =>
      slugsText
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    [slugsText],
  );

  // The diff: only the settings whose edited value differs from the current.
  const patch = useMemo<PlatformSettingsInput>(() => {
    const p: PlatformSettingsInput = {};
    if (signupMode !== values.signupMode) p.signupMode = signupMode;

    const limitNum = Number(limit);
    const ttlNum = Number(ttl);
    if (
      Number.isInteger(limitNum) &&
      Number.isInteger(ttlNum) &&
      (limitNum !== values.rateLimit.limit || ttlNum !== values.rateLimit.ttlSeconds)
    ) {
      p.rateLimit = { limit: limitNum, ttlSeconds: ttlNum };
    }

    if (JSON.stringify(parsedSlugs) !== JSON.stringify(values.reservedSlugs)) {
      p.reservedSlugs = parsedSlugs;
    }

    if (banner !== values.banner.message || bannerLevel !== values.banner.level) {
      p.banner = { message: banner, level: bannerLevel };
    }

    if (JSON.stringify(flags) !== JSON.stringify(values.featureFlags)) {
      p.featureFlags = flags;
    }
    return p;
  }, [signupMode, limit, ttl, parsedSlugs, banner, bannerLevel, flags, values]);

  const dirty = Object.keys(patch).length > 0;

  const onSave = () => {
    if (!dirty) return;
    update.mutate(patch, {
      onSuccess: () => toast.show({ message: "Settings saved." }),
      onError: (e) =>
        toast.show({ message: e instanceof Error ? e.message : "Could not save settings.", tone: "error" }),
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
      {/* Sign-ups */}
      <Card>
        <CardHeader title="Sign-ups" />
        <CardBody className="space-y-2">
          <Field label="Who can create a new account" controlId="signup-mode">
            <Segmented
              id="signup-mode"
              aria-label="Who can create a new account"
              options={SIGNUP_OPTIONS}
              value={signupMode}
              onChange={setSignupMode}
            />
          </Field>
          <p className="text-[11.5px] text-ink-3">
            Invite only and closed both block the open register form and a brand-new Google sign-in; an invited person
            still joins through their invitation link.
          </p>
          <div className="flex items-center gap-2">
            <Chip tone="default">Default: {defaults.signupMode}</Chip>
            <Provenance settings={settings} settingKey="signupMode" />
          </div>
        </CardBody>
      </Card>

      {/* Rate limit */}
      <Card>
        <CardHeader title="Rate limit" />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <Field label="Requests per window">
              <Input
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="w-40"
              />
            </Field>
            <Field label="Window (seconds)">
              <Input inputMode="numeric" value={ttl} onChange={(e) => setTtl(e.target.value)} className="w-40" />
            </Field>
          </div>
          <p className="text-[11.5px] text-ink-3">
            The global per-IP request limit. Tighter route-specific limits (sign-in, unlock) are set in code and not
            affected. Applies without a restart.
          </p>
          <div className="flex items-center gap-2">
            <Chip tone="default">
              Default: {defaults.rateLimit.limit} / {defaults.rateLimit.ttlSeconds}s
            </Chip>
            <Provenance settings={settings} settingKey="rateLimit" />
          </div>
        </CardBody>
      </Card>

      {/* Reserved slugs */}
      <Card>
        <CardHeader title="Reserved back-halves" />
        <CardBody className="space-y-2">
          <Field label="Comma-separated back-halves nobody may claim">
            <Input value={slugsText} onChange={(e) => setSlugsText(e.target.value)} placeholder="e.g. pricing, blog, go" />
          </Field>
          <p className="text-[11.5px] text-ink-3">
            Added on top of SnapURL&rsquo;s built-in reserved list. {parsedSlugs.length} reserved.
          </p>
          <Provenance settings={settings} settingKey="reservedSlugs" />
        </CardBody>
      </Card>

      {/* Banner */}
      <Card>
        <CardHeader title="Site-wide banner" />
        <CardBody className="space-y-3">
          <Field label="Message (leave empty for no banner)">
            <Input value={banner} onChange={(e) => setBanner(e.target.value)} placeholder="e.g. Scheduled maintenance at 02:00 UTC" />
          </Field>
          <Field label="Level" controlId="banner-level">
            <Segmented
              id="banner-level"
              aria-label="Banner level"
              options={BANNER_LEVELS.map((l) => ({ value: l.value, label: l.label }))}
              value={bannerLevel}
              onChange={setBannerLevel}
            />
          </Field>
          <Provenance settings={settings} settingKey="banner" />
        </CardBody>
      </Card>

      {/* Feature flags */}
      <Card>
        <CardHeader title="Feature switches" />
        <CardBody className="space-y-3">
          {Object.keys(flags).length === 0 ? (
            <p className="text-sm text-ink-3">No feature switches yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(flags).map(([key, on]) => (
                <Toggle
                  key={key}
                  checked={on}
                  onChange={(v) => setFlags((f) => ({ ...f, [key]: v }))}
                  title={key}
                  description={on ? "On" : "Off"}
                />
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Field label="Add a switch">
              <Input
                value={newFlag}
                onChange={(e) => setNewFlag(e.target.value)}
                placeholder="feature.key"
                className="w-64"
              />
            </Field>
            <Button
              type="button"
              variant="default"
              disabled={newFlag.trim().length === 0 || newFlag.trim() in flags}
              onClick={() => {
                const k = newFlag.trim();
                if (k && !(k in flags)) {
                  setFlags((f) => ({ ...f, [k]: false }));
                  setNewFlag("");
                }
              }}
            >
              Add
            </Button>
          </div>
          <Provenance settings={settings} settingKey="featureFlags" />
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || update.isPending}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
        {!dirty ? <span className="text-xs text-ink-3">No changes to save.</span> : null}
      </div>
    </form>
  );
}
