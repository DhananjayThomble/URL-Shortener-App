import { Inject, Injectable } from "@nestjs/common";
import {
  BannerSetting,
  BotProtectionSetting,
  DEFAULT_KILL_SWITCHES,
  DisposableEmailSetting,
  KillSwitchesSetting,
  NewAccountLimitsSetting,
  PlatformBanner,
  PlatformSettings,
  PlatformSettingsInput,
  PlatformSettingsValues,
  RateLimitSetting,
  SignupMode,
  type PlatformSettingMeta,
} from "@snapurl/contract";
import { platformSettings, writeAdminAuditEntry, type Database } from "@snapurl/database";
import { z } from "zod";
import { DB } from "../database/database.module.js";
import { ENV, type Env } from "../config/env.js";
import type { AdminActor } from "./admin-management.service.js";

/* ============================================================
   #972 — the runtime platform-settings store (admin panel 5/7).

   The API reads these settings on the hot path (every register, every
   throttled request), so it must NOT hit the database per request, and it must
   NOT freeze them at module init either — an operator who closes signups wants
   it to take effect without a redeploy. The middle ground the issue asks for is
   a SHORT in-process cache: read the whole store once, hold it for about a
   minute, and reload on the next read after that. A change lands within the
   cache window everywhere; an own write busts the cache immediately so the
   admin who just changed a setting sees it at once.

   One entry per setting KEY in the DB. A key with no row means "never set" and
   the effective value falls back to the compiled-in default (and, for the rate
   limit, to the THROTTLE_* env values) — so an empty table is byte-identical to
   the behaviour before this store existed.

   Every write goes through writeAdminAuditEntry with the before/after values,
   in the same transaction as the upsert, so the audit trail can never miss a
   settings change.
   ============================================================ */

/** The setting keys, as stored in platform_settings.key and surfaced in the
 *  admin UI's per-setting "last changed by". Kept as a const tuple so the meta
 *  map and the audit action keys stay in lock-step with the value shape. */
export const SETTING_KEYS = [
  "signupMode",
  "rateLimit",
  "reservedSlugs",
  "featureFlags",
  "banner",
  // #993 — launch-readiness abuse controls.
  "newAccountLimits",
  "botProtection",
  "disposableEmails",
  // #1020 — the typed kill-switch set.
  "killSwitches",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Per-key value schema, used to validate a jsonb row on read so a value that
 *  was written by a newer/older deploy (or hand-edited in the DB) can never
 *  crash the hot path — an unparseable row is ignored and the default used. */
const KEY_SCHEMA: Record<SettingKey, z.ZodTypeAny> = {
  signupMode: SignupMode,
  rateLimit: RateLimitSetting,
  reservedSlugs: z.array(z.string()),
  featureFlags: z.record(z.string(), z.boolean()),
  banner: BannerSetting,
  newAccountLimits: NewAccountLimitsSetting,
  botProtection: BotProtectionSetting,
  disposableEmails: DisposableEmailSetting,
  killSwitches: KillSwitchesSetting,
};

/** How long a loaded snapshot is served before the next read reloads it. The
 *  issue asks for "about a minute"; this is that window. Public so a test can
 *  reason about the boundary without guessing. */
export const SETTINGS_CACHE_TTL_MS = 60_000;

interface Snapshot {
  values: PlatformSettingsValues;
  meta: Record<SettingKey, PlatformSettingMeta>;
}

@Injectable()
export class PlatformSettingsService {
  /** The compiled-in defaults, with the two rate-limit fields taken from the
   *  configured env values so an empty store reproduces today's limits. */
  private readonly defaults: PlatformSettingsValues;

  private cache: Snapshot | null = null;
  private loadedAtMs = 0;

  /** The clock the cache window is measured against. A plain field (NOT a
   *  constructor parameter) so Nest's DI never tries to resolve it as a
   *  provider — an un-injectable `() => number` param made the container throw
   *  UnknownDependenciesException at boot. Defaults to the real wall clock; a
   *  test swaps it via setClockForTesting to drive the window deterministically. */
  private now: () => number = Date.now;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) env: Env,
  ) {
    this.defaults = {
      signupMode: "open",
      rateLimit: { limit: env.THROTTLE_LIMIT, ttlSeconds: env.THROTTLE_TTL_SECONDS },
      reservedSlugs: [],
      featureFlags: {},
      banner: { message: "", level: "info" },
      /* #993 — the issue's suggested defaults: a brand-new account's links are
         capped for its first 7 days at 20/day and 10/hour. The gate is ON by
         default (an empty store reproduces these), because launch readiness is
         the point; an operator loosens or lifts it from the panel. The window
         comes from NEW_ACCOUNT_LINK_WINDOW_DAYS (default 7) so the compose/local
         test environment can set it to 0 (caps off) without weakening the
         production default — the smoke harness creates many links through one
         account and must not be throttled. */
      newAccountLimits: { windowDays: env.NEW_ACCOUNT_LINK_WINDOW_DAYS, perDay: 20, perHour: 10 },
      /* #993 — bot protection is OFF by default so a self-hoster needs no
         third-party provider to register. The operator turns on turnstile or
         hcaptcha from the panel once they have configured the secret. */
      botProtection: { provider: "none" },
      /* #993 / #1007 — no operator additions or allow entries by default; the
         vendored block list and the built-in allow list still apply on top of
         this (folded in by the caller). */
      disposableEmails: { extraDomains: [], allowDomains: [] },
      /* #1020 — billing + custom domains ship OFF (turning them on is an
         explicit act and fail-closed reads them OFF); the cost-incurring
         background switches ship ON so a fresh/unreadable store keeps today's
         mail and error reporting. The shipped caps are generous-but-finite. */
      killSwitches: structuredClone(DEFAULT_KILL_SWITCHES),
    };
  }

  /** Test-only: replace the clock so a test can advance the cache window in
   *  milliseconds. Not used by production code. */
  setClockForTesting(now: () => number): void {
    this.now = now;
  }

  /**
   * The effective values in use right now, through the short cache.
   *
   * Reloads from the database only when the cached snapshot is older than the
   * TTL (or there is none yet), so the common case is a field read with no
   * query. This is what the throttler and the auth paths call per request.
   */
  async getValues(): Promise<PlatformSettingsValues> {
    return (await this.snapshot()).values;
  }

  /** The current banner, for the public (unauthenticated) read. Served through
   *  the same cache as everything else. */
  async getBanner(): Promise<PlatformBanner> {
    const { message, level } = (await this.snapshot()).values.banner;
    return { message, level };
  }

  /** The full admin view: effective values, the defaults column, and the
   *  per-setting provenance. Always reads a FRESH snapshot (not the cache) so
   *  an admin opening the page never sees a value up to a minute stale. */
  async getForAdmin(): Promise<PlatformSettings> {
    const snap = await this.load();
    this.cache = snap;
    this.loadedAtMs = this.now();
    return { values: snap.values, defaults: this.defaults, meta: snap.meta };
  }

  /**
   * Apply a settings change and record it.
   *
   * Each provided key is upserted into platform_settings, and ONE audit row is
   * written per changed key with its before/after value, all inside a single
   * transaction so the change and its record commit together. The in-process
   * cache is cleared at the end so the next read reflects the write immediately
   * on this instance; other instances pick it up within the cache window.
   */
  async update(input: PlatformSettingsInput, actor: AdminActor): Promise<PlatformSettings> {
    // The before-state the audit rows compare against: the current effective
    // values (defaults folded in), read fresh so a concurrent change is seen.
    const before = (await this.load()).values;

    // killSwitches has its OWN typed PATCH (writeKillSwitches); it is not part
    // of the generic PlatformSettingsInput, so the generic update never touches
    // it. Iterate only the keys the generic input carries.
    const genericKeys = SETTING_KEYS.filter((k): k is Exclude<SettingKey, "killSwitches"> => k !== "killSwitches");
    const entries = genericKeys
      .filter((k) => input[k] !== undefined)
      .map((k) => [k, input[k]] as [SettingKey, unknown]);

    await this.db.transaction(async (tx) => {
      const nowDate = new Date();
      for (const [key, value] of entries) {
        await tx
          .insert(platformSettings)
          .values({
            key,
            value,
            updatedById: actor.admin.id,
            updatedByLabel: actor.admin.email,
            updatedAt: nowDate,
          })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: {
              value,
              updatedById: actor.admin.id,
              updatedByLabel: actor.admin.email,
              updatedAt: nowDate,
            },
          });

        await writeAdminAuditEntry(tx, {
          actorId: actor.admin.id,
          actorLabel: actor.admin.email,
          action: `admin.settings.${key}`,
          targetType: "platform_setting",
          targetId: key,
          before: { [key]: before[key] },
          after: { [key]: value },
          requestIp: actor.ip,
        });
      }
    });

    this.invalidate();
    return this.getForAdmin();
  }

  /* ── #1020 kill switches ── */

  /** The effective kill-switch set in use right now, through the short cache.
   *  Read on the hot paths (billing, custom-domains, mail) via the SAME cache
   *  as every other setting — one load serves them all. */
  async getKillSwitches(): Promise<KillSwitchesSetting> {
    return (await this.snapshot()).values.killSwitches;
  }

  /** The full admin view of the kill switches: the effective values, the
   *  defaults (for the UI's reset/"default" column), and the provenance. Reads
   *  a FRESH snapshot so an admin opening the page is never up to a minute
   *  stale. */
  async getKillSwitchesForAdmin(): Promise<{
    values: KillSwitchesSetting;
    defaults: KillSwitchesSetting;
    meta: PlatformSettingMeta;
  }> {
    const snap = await this.load();
    this.cache = snap;
    this.loadedAtMs = this.now();
    return {
      values: snap.values.killSwitches,
      defaults: this.defaults.killSwitches,
      meta: snap.meta.killSwitches,
    };
  }

  /**
   * Write the kill-switch set, folding a partial change onto the current value,
   * and record ONE before/after audit row — all in a single transaction with
   * the upsert, exactly like {@link update}. `fold` is given the current
   * effective value and returns the next full value; the caller (KillSwitchService)
   * does the field-level folding so this method stays a plain store write.
   * Busts the cache so the next read reflects the change at once on this
   * instance; other instances pick it up within the cache window.
   */
  async writeKillSwitches(
    fold: (current: KillSwitchesSetting) => KillSwitchesSetting,
    actor: AdminActor,
    reason: string,
  ): Promise<KillSwitchesSetting> {
    const before = (await this.load()).values.killSwitches;
    const after = fold(before);

    await this.db.transaction(async (tx) => {
      const nowDate = new Date();
      await tx
        .insert(platformSettings)
        .values({
          key: "killSwitches",
          value: after,
          updatedById: actor.admin.id,
          updatedByLabel: actor.admin.email,
          updatedAt: nowDate,
        })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: {
            value: after,
            updatedById: actor.admin.id,
            updatedByLabel: actor.admin.email,
            updatedAt: nowDate,
          },
        });

      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.settings.killSwitches",
        targetType: "platform_setting",
        targetId: "killSwitches",
        // The operator's required reason rides in the before context so the
        // admin page's change history (read off the audit trail) explains WHY
        // each change was made, alongside the before/after values.
        before: { killSwitches: before, reason },
        after: { killSwitches: after },
        requestIp: actor.ip,
      });
    });

    this.invalidate();
    return after;
  }

  /** Drop the cached snapshot so the next read reloads. Called after a write on
   *  this instance; also useful to a test that wants a forced reload. */
  invalidate(): void {
    this.cache = null;
    this.loadedAtMs = 0;
  }

  /* ── internals ── */

  /** The cached snapshot, reloading when stale. */
  private async snapshot(): Promise<Snapshot> {
    if (this.cache && this.now() - this.loadedAtMs < SETTINGS_CACHE_TTL_MS) {
      return this.cache;
    }
    const snap = await this.load();
    this.cache = snap;
    this.loadedAtMs = this.now();
    return snap;
  }

  /** Read every row and fold it onto the defaults. A row that fails its key's
   *  schema (a stale or hand-edited shape) is ignored so the hot path can never
   *  throw on a bad value — the default stands and the admin page shows the
   *  provenance so the operator can re-save it. */
  private async load(): Promise<Snapshot> {
    const rows = await this.db
      .select({
        key: platformSettings.key,
        value: platformSettings.value,
        updatedAt: platformSettings.updatedAt,
        updatedByLabel: platformSettings.updatedByLabel,
      })
      .from(platformSettings);

    const values: PlatformSettingsValues = {
      signupMode: this.defaults.signupMode,
      rateLimit: { ...this.defaults.rateLimit },
      reservedSlugs: [...this.defaults.reservedSlugs],
      featureFlags: { ...this.defaults.featureFlags },
      banner: { ...this.defaults.banner },
      newAccountLimits: { ...this.defaults.newAccountLimits },
      botProtection: { ...this.defaults.botProtection },
      disposableEmails: {
        extraDomains: [...this.defaults.disposableEmails.extraDomains],
        allowDomains: [...this.defaults.disposableEmails.allowDomains],
      },
      killSwitches: structuredClone(this.defaults.killSwitches),
    };
    const meta = Object.fromEntries(
      SETTING_KEYS.map((k) => [k, { updatedAt: null, updatedBy: null } as PlatformSettingMeta]),
    ) as Record<SettingKey, PlatformSettingMeta>;

    for (const row of rows) {
      if (!this.isSettingKey(row.key)) continue;
      const parsed = KEY_SCHEMA[row.key].safeParse(row.value);
      if (!parsed.success) continue; // ignore an unparseable row, keep the default
      (values as Record<SettingKey, unknown>)[row.key] = parsed.data;
      meta[row.key] = {
        updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
        updatedBy: row.updatedByLabel ?? null,
      };
    }

    return { values, meta };
  }

  private isSettingKey(key: string): key is SettingKey {
    return (SETTING_KEYS as readonly string[]).includes(key);
  }
}
