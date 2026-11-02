/**
 * Journeys global teardown (#1030).
 *
 * Drops the platform_settings "killSwitches" row that global-setup seeded ON
 * with generous caps, returning the staging platform to the shipped defaults
 * (switches OFF, 25-total/5-per-day domains, 200/h email). The staging DB is
 * shared across runs, so leaving the generous caps behind would mask a real cap
 * regression in a later run. Mirrors the HTTP-stack teardown in principals.ts.
 */
import { resetKillSwitches } from "./helpers";

export default async function globalTeardown(): Promise<void> {
  await resetKillSwitches();
}
