"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  AuthSession,
  AuthUser,
  LoginResult,
  TotpRecoveryCodes,
  TotpSetup,
  type EmailVerifyInput,
  type EmailVerifyResendInput,
  type LoginInput,
  type OAuthSignInInput,
  type PasswordResetConfirmInput,
  type PasswordResetRequestInput,
  type RegisterInput,
  type TotpDisableInput,
  type TotpEnableInput,
  type TotpVerifyInput,
} from "@snapurl/contract";
import { request, tokens } from "../client";
import { signedInTarget } from "../../safe-next";
import { hasStoredSession } from "../../session-hint";
import { qk } from "./keys";

export function useMe(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => request("/auth/me", AuthUser),
    retry: false,
    staleTime: 5 * 60_000,
    enabled: opts.enabled ?? true,
  });
}

/**
 * /login and /register: if the visitor is already signed in, send them on
 * (#777) — to the safe `?next=`, else the dashboard.
 *
 * It asks the API (GET /auth/me) rather than trusting the stored tokens. A
 * token that is merely PRESENT may be expired or revoked; redirecting on that
 * alone would send the visitor to the dashboard guard, which would send them
 * straight back here — a loop. Verified this way, the three outcomes are:
 *   - session good        -> router.replace(target); never the form.
 *   - expired/revoked     -> /auth/me 401 -> the client's refresh fails and
 *                            clears the tokens -> the form is shown.
 *   - API down (5xx/net)  -> the form is shown and the tokens are kept; no
 *                            redirect happens, so nothing can bounce.
 * A visitor with no stored token makes no request at all.
 *
 * The probe settles once. A sign-in made on this page afterwards sets the
 * `me` cache itself and must not trigger a second navigation on top of the
 * form's own.
 *
 * `checking` is true while the verification is in flight, so the page can show
 * a status instead of a form that is about to disappear.
 */
export function useRedirectIfSignedIn(nextParam: string | null): { checking: boolean } {
  const router = useRouter();
  const [probing, setProbing] = useState(false);
  const [settled, setSettled] = useState(false);
  const settledRef = useRef(false);
  // Before first paint (layout effect), so a signed-in visitor never sees the
  // form flash up. After mount, never during render: localStorage does not
  // exist on the server.
  useLayoutEffect(() => {
    if (hasStoredSession()) setProbing(true);
  }, []);
  const me = useMe({ enabled: probing });
  useEffect(() => {
    if (!probing || settledRef.current) return;
    if (me.isSuccess) {
      settledRef.current = true;
      router.replace(signedInTarget(nextParam));
    } else if (me.isError) {
      settledRef.current = true;
      setSettled(true);
    }
  }, [probing, me.isSuccess, me.isError, nextParam, router]);
  // On success the page is being left, so `checking` stays true until it is.
  return { checking: probing && !settled };
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

/* P0 — account recovery (#363, #364, #638). Both request/confirm are public
 * (anonymous: true) — a locked-out user by definition has no access token.
 * request and resend deliberately return no usable body (202, z.undefined()):
 * the API gives the SAME response whether or not the email has an account, so
 * neither hook can be used to tell. Callers must show a fixed confirmation,
 * never branch on the result.
 */
export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (body: PasswordResetRequestInput) =>
      request("/auth/password-reset/request", z.undefined(), { method: "POST", body, anonymous: true }),
  });
}

export function useConfirmPasswordReset() {
  return useMutation({
    mutationFn: (body: PasswordResetConfirmInput) =>
      request("/auth/password-reset/confirm", z.undefined(), { method: "POST", body, anonymous: true }),
  });
}

/* P0 — email verification (#638). verify is called from a link clicked in an
 * email, often before the visitor has ever signed in on this device/browser —
 * anonymous: true, same as the password-reset pair. resend mirrors request's
 * anti-enumeration shape (202, no usable body). */
export function useVerifyEmail() {
  return useMutation({
    mutationFn: (body: EmailVerifyInput) =>
      request("/auth/email/verify", z.undefined(), { method: "POST", body, anonymous: true }),
  });
}

export function useResendEmailVerification() {
  return useMutation({
    mutationFn: (body: EmailVerifyResendInput) =>
      request("/auth/email/resend", z.undefined(), { method: "POST", body, anonymous: true }),
  });
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
