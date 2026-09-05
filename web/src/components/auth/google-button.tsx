"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useOAuthSignIn } from "@/lib/api/hooks";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/** Whether the page should show anything Google-shaped at all — the button,
 *  and the "or" divider above the password form that would otherwise divide
 *  the form from nothing. */
export const hasGoogleAuth = Boolean(CLIENT_ID);

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: {
            client_id: string;
            nonce: string;
            auto_select?: boolean;
            callback: (response: { credential: string }) => void;
          }): void;
          renderButton(
            parent: HTMLElement,
            options: {
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              shape?: "rectangular" | "pill";
              width?: number;
              text?: "signin_with" | "signup_with" | "continue_with";
              logo_alignment?: "left" | "center";
            },
          ): void;
        };
      };
    };
  }
}

function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * "Continue with Google". Renders nothing when NEXT_PUBLIC_GOOGLE_CLIENT_ID is
 * unset — matching OAuthService.enabled() on the API side, a provider with no
 * client id configured is switched off, not half-shown.
 *
 * The nonce (#263) is generated once per mount and handed to Google's SDK as
 * the ID token's `nonce` claim; the same value goes to POST /auth/oauth so the
 * API can confirm this exact attempt produced the token rather than replaying
 * an earlier one. It lives only in this component's memory: a reload
 * abandons the in-flight attempt and the next mount generates its own, so
 * there is nothing that needs to survive one.
 */
export function GoogleButton({ text = "continue_with" }: { text?: "signin_with" | "signup_with" | "continue_with" }) {
  const router = useRouter();
  const oauthSignIn = useOAuthSignIn();
  const containerRef = useRef<HTMLDivElement>(null);
  const nonceRef = useRef<string | null>(null);
  nonceRef.current ??= CLIENT_ID ? generateNonce() : null;
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  if (!CLIENT_ID) return null;

  const renderGoogleButton = () => {
    const google = window.google;
    const nonce = nonceRef.current;
    if (!google || !containerRef.current || !nonce) return;

    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      nonce,
      // Selecting silently would sign someone in without a click they can
      // point to — the button exists so consent is unambiguous.
      auto_select: false,
      callback: (response) => {
        setError(null);
        oauthSignIn
          .mutateAsync({ provider: "google", idToken: response.credential, nonce })
          .then((result) => {
            // Same union, same narrowing as password login (useLogin):
            // a 2FA challenge is not yet a session.
            if ("challenge" in result) return;
            router.push("/links");
          })
          .catch((err: unknown) => setError(err instanceof Error ? err.message : "Google sign-in failed. Try again."));
      },
    });
    google.accounts.id.renderButton(containerRef.current, {
      theme: "outline",
      size: "large",
      shape: "rectangular",
      width: Math.min(containerRef.current.clientWidth || 352, 400),
      text,
      logo_alignment: "left",
    });
  };

  return (
    <div>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={renderGoogleButton}
        onError={() => setBlocked(true)}
      />
      <div ref={containerRef} className="[&>div]:!w-full" />
      {blocked ? (
        <p className="text-[12.5px] text-ink-3 m-0 mt-2">
          Google sign-in didn&apos;t load — an ad blocker or content blocker may be preventing it.
        </p>
      ) : null}
      {error ? <p className="text-[12.5px] text-bad m-0 mt-2">{error}</p> : null}
    </div>
  );
}
