// @vitest-environment happy-dom
//
// Google sign-in for an account with 2FA on. The API answers POST /auth/oauth
// with { challenge: "totp", challengeToken } instead of a session; GoogleButton
// used to drop it, so the user saw nothing happen. Both /login and /register
// must show the code step, and a valid code must verify and navigate.
// The oracle is the rendered DOM plus the verify + router.push calls; the
// token must stay in memory (no URL / storage).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const verifyMutate = vi.fn();
const oauthMutate = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: (props: { href: string; children?: unknown }) => createElement("a", { href: props.href }, props.children as never),
}));
// Stand-in for the GIS <Script>: fires onReady once mounted, like the real one.
vi.mock("next/script", () => ({
  default: (props: { onReady?: () => void }) => {
    useEffect(() => props.onReady?.(), [props]);
    return null;
  },
}));
vi.mock("@/lib/api/hooks", () => ({
  useOAuthSignIn: () => ({ mutateAsync: oauthMutate }),
  useRedirectIfSignedIn: () => ({ checking: false }),
  useLogin: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useRegister: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useVerifyTotp: () => ({ mutateAsync: verifyMutate, isPending: false }),
}));

let root: Root;
let host: HTMLElement;
let googleCallback: ((r: { credential: string }) => void) | undefined;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com");
  vi.resetModules();
  push.mockReset();
  verifyMutate.mockReset().mockResolvedValue({});
  oauthMutate.mockReset().mockResolvedValue({ challenge: "totp", challengeToken: "chal-123" });
  googleCallback = undefined;
  (window as unknown as { google: unknown }).google = {
    accounts: {
      id: {
        initialize: (cfg: { callback: typeof googleCallback }) => {
          googleCallback = cfg.callback;
        },
        renderButton: () => {},
      },
    },
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe.each([
  ["/login", () => import("./login/page")],
  ["/register", () => import("./register/page")],
])("Google 2FA challenge on %s", (_name, load) => {
  it("shows the code step, then verifies the code and navigates", async () => {
    const Page = (await load()).default;
    await act(async () => {
      root.render(createElement(Page));
    });
    expect(googleCallback).toBeDefined();

    await act(async () => {
      googleCallback!({ credential: "google-id-token" });
    });
    await flush();

    // The code step is on screen (it used to be nothing at all).
    const input = host.querySelector<HTMLInputElement>('input[name="one-time-code"]');
    expect(input).not.toBeNull();
    expect(host.textContent).toContain("Two-factor authentication");

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "123456");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(verifyMutate).toHaveBeenCalledWith({ challengeToken: "chal-123", code: "123456" });
    expect(push).toHaveBeenCalledTimes(1);

    // The token never leaves memory.
    expect(window.location.href).not.toContain("chal-123");
    expect(JSON.stringify({ ...localStorage })).not.toContain("chal-123");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("chal-123");
  });
});
