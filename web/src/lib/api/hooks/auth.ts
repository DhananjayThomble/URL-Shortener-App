"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  AuthSession,
  AuthUser,
  LoginResult,
  TotpRecoveryCodes,
  TotpSetup,
  type LoginInput,
  type OAuthSignInInput,
  type RegisterInput,
  type TotpDisableInput,
  type TotpEnableInput,
  type TotpVerifyInput,
} from "@snapurl/contract";
import { request, tokens } from "../client";
import { qk } from "./keys";

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => request("/auth/me", AuthUser),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/**
 * Sign in.
 *
 * The response is a union: a session, or a TOTP challenge when the account has
 * two-factor enabled. Callers must narrow on `"challenge" in result` — the type
 * makes that unavoidable, which is the point. Only the session branch stores
 * tokens; a challenge is not yet an authenticated session.
 */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginInput) => request("/auth/login", LoginResult, { method: "POST", body, anonymous: true }),
    onSuccess: (result) => {
      if ("challenge" in result) return;
      tokens.set(result.accessToken, result.refreshToken);
      qc.setQueryData(qk.me, result.user);
    },
  });
}

/**
 * Google/Apple sign-in (#263). Same response union and the same "challenge"
 * narrowing as useLogin — a provider sign-in does not bypass a second factor
 * the account owner turned on.
 *
 * `nonce` must be the exact value passed to the provider's SDK for this
 * attempt (see GoogleButton) — it is how the API tells a fresh token from a
 * replayed one.
 */
export function useOAuthSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OAuthSignInInput) =>
      request("/auth/oauth", LoginResult, { method: "POST", body, anonymous: true }),
    onSuccess: (result) => {
      if ("challenge" in result) return;
      tokens.set(result.accessToken, result.refreshToken);
      qc.setQueryData(qk.me, result.user);
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterInput) =>
      request("/auth/register", AuthSession, { method: "POST", body, anonymous: true }),
    onSuccess: (session) => {
      tokens.set(session.accessToken, session.refreshToken);
      qc.setQueryData(qk.me, session.user);
    },
  });
}

/**
 * Sign out, on the server as well as in this tab.
 *
 * Clearing localStorage alone left the refresh token valid for its full
 * 30-day life, so anyone who had captured it kept access after the user
 * believed they had signed out. `POST /auth/logout` revokes the whole token
 * family server-side.
 *
 * The request is deliberately not awaited: a network failure must not trap
 * someone in a session they asked to leave. Local state is cleared either way,
 * and an unrevoked token expires on its own — the failure mode is the old
 * behaviour, not something worse.
 */
export function useLogout() {
  const qc = useQueryClient();
  return (allDevices = false) => {
    const refreshToken = tokens.refresh;
    if (refreshToken) {
      void request("/auth/logout", z.undefined(), {
        method: "POST",
        body: { refreshToken, allDevices },
        // The access token may already have expired by the time someone clicks
        // sign out; the refresh token in the body is the credential here.
        anonymous: true,
        // We navigate to /login immediately after this call. Without keepalive
        // the browser may cancel it mid-flight and the token stays valid —
        // reintroducing the exact bug this call exists to fix.
        keepalive: true,
      }).catch(() => {
        /* Already leaving. Nothing useful to show the user. */
      });
    }
    tokens.clear();
    qc.clear();
  };
}

/* Two-factor (G6). The team page renders a 2FA column, so there has to be a
   way for it to become true. */

/** Returns the otpauth:// URI to render as a QR code, plus the raw secret for
 *  manual entry. Enrolment is not complete until useEnableTotp succeeds. */
export function useSetupTotp() {
  return useMutation({ mutationFn: () => request("/auth/2fa/setup", TotpSetup, { method: "POST" }) });
}

/** Confirms enrolment and returns the ten single-use recovery codes. They are
 *  shown once and never again — without them a lost phone is a lost account. */
export function useEnableTotp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TotpEnableInput) =>
      request("/auth/2fa/enable", TotpRecoveryCodes, { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: qk.members });
    },
  });
}

/** Completes a login that came back as a TOTP challenge. Accepts a six-digit
 *  code or one of the recovery codes. */
export function useVerifyTotp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TotpVerifyInput) =>
      request("/auth/2fa/verify", AuthSession, { method: "POST", body, anonymous: true }),
    onSuccess: (session) => {
      tokens.set(session.accessToken, session.refreshToken);
      qc.setQueryData(qk.me, session.user);
    },
  });
}

export function useDisableTotp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TotpDisableInput) =>
      request("/auth/2fa/disable", z.undefined(), { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: qk.members });
    },
  });
}
