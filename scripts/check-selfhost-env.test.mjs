// #998 — unit tests for the self-host env-var consistency check, run by
// `node --test`. The decision core findMissingEnvVars is PURE (two strings in,
// a list out), so every case is driven inline with no filesystem.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  envExampleKeys,
  mentionedEnvVars,
  findMissingEnvVars,
} from "./check-selfhost-env.mjs";

test("envExampleKeys reads active and commented-out keys", () => {
  const example = [
    "APP_DOMAIN=example.com",
    "# commentary, not a key",
    "# MAIL_OUTBOX_DIR=/data/outbox",
    "#CACHE_DRIVER=memory",
  ].join("\n");
  const keys = envExampleKeys(example);
  assert.ok(keys.has("APP_DOMAIN"));
  assert.ok(keys.has("MAIL_OUTBOX_DIR"), "a commented-out key counts as present");
  assert.ok(keys.has("CACHE_DRIVER"));
});

test("mentionedEnvVars collects UPPER_SNAKE tokens but not prose acronyms", () => {
  const guide = "Set APP_DOMAIN and JWT_ACCESS_SECRET. TLS and DNS are prose, not vars.";
  const vars = mentionedEnvVars(guide);
  assert.ok(vars.has("APP_DOMAIN"));
  assert.ok(vars.has("JWT_ACCESS_SECRET"));
  assert.ok(!vars.has("TLS"), "a single-word acronym is not an env var");
  assert.ok(!vars.has("DNS"));
});

test("passes when every mentioned var is a key or a documented exception", () => {
  const guide = "Set APP_DOMAIN. For a custom dump client set PG_DUMP.";
  const example = "APP_DOMAIN=example.com\n";
  // PG_DUMP is in the default EXCEPTIONS set.
  assert.deepEqual(findMissingEnvVars(guide, example), []);
});

test("fails (lists the var) when a mentioned var is missing and not excepted", () => {
  const guide = "Set APP_DOMAIN and the undocumented SECRET_SAUCE_KEY.";
  const example = "APP_DOMAIN=example.com\n";
  assert.deepEqual(findMissingEnvVars(guide, example), ["SECRET_SAUCE_KEY"]);
});

test("a commented-out example key satisfies a mentioned var", () => {
  const guide = "Advanced: set CLICK_EVENTS_RETENTION_YEARS to change the window.";
  const example = "APP_DOMAIN=x\n# CLICK_EVENTS_RETENTION_YEARS=3\n";
  assert.deepEqual(findMissingEnvVars(guide, example), []);
});

test("custom exceptions override the default set", () => {
  const guide = "ONLY_IN_SCRIPTS is read by a helper, not .env.";
  const example = "APP_DOMAIN=x\n";
  const exceptions = new Map([["ONLY_IN_SCRIPTS", "helper override"]]);
  assert.deepEqual(findMissingEnvVars(guide, example, exceptions), []);
});
