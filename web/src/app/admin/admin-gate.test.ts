// @vitest-environment happy-dom
//
// #968 — the /admin area is unreachable for a non-admin.
//
// The gate's decision is the SERVER's answer to GET /admin/me, surfaced through
// useAdminMe. These cases prove the gate acts on each answer correctly:
//   - 403 (signed in, not an admin)  -> "Not authorised", admin children NOT in the DOM.
//   - 200 (confirmed admin)          -> admin children ARE rendered.
//   - 401 (not signed in)            -> redirected to /login, nothing admin rendered.
//
// The oracle is the DOM the gate produces for each hook state. Admin content is
// identified by a sentinel child, so "unreachable" is literally asserted: the
// sentinel is absent unless the server said 200.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";

/* The hook state the gate reads, swapped per test. */
let hookState: {
  data?: unknown;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
};

vi.mock("@/lib/api/hooks", () => ({
  useAdminMe: () => hookState,
}));

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/admin",
}));

/* next/link renders a plain <a> under happy-dom. */
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

const SENTINEL = "ADMIN-ONLY-CONTENT";

let container: HTMLDivElement;
let root: Root;

// Imported ONCE, not per-test: re-importing under vi.resetModules() would give
// the component a different ApiError class than the one the test constructs, so
// `error instanceof ApiError` inside the gate would silently never match.
import { AdminGate } from "./admin-gate";

async function renderGate() {
  await act(async () => {
    root.render(createElement(AdminGate, null, createElement("div", null, SENTINEL)));
  });
  // A second empty act() tick flushes the passive effect (the 401 redirect runs
  // in a useEffect, which React schedules after the commit above).
  await act(async () => {});
}

beforeEach(() => {
  replace.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AdminGate — /admin is unreachable for a non-admin (#968)", () => {
  it("renders 'Not authorised' and NO admin content when the server answers 403", async () => {
    hookState = { isPending: false, isError: true, error: new ApiError(403, "forbidden") };
    await renderGate();

    expect(container.textContent).toContain("Not authorised");
    expect(container.textContent).not.toContain(SENTINEL);
    // A 403 is not a sign-in problem, so it must not bounce to /login.
    expect(replace).not.toHaveBeenCalled();
  });

  it("renders the admin content when the server confirms the caller is an admin (200)", async () => {
    hookState = {
      data: { id: "u1", name: "Ada", email: "ada@example.com", isPlatformAdmin: true },
      isPending: false,
      isError: false,
    };
    await renderGate();

    expect(container.textContent).toContain(SENTINEL);
    expect(container.textContent).not.toContain("Not authorised");
  });

  it("redirects to /login and renders no admin content when not signed in (401)", async () => {
    hookState = { isPending: false, isError: true, error: new ApiError(401, "unauthorised") };
    await renderGate();

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]![0]).toContain("/login");
    expect(container.textContent).not.toContain(SENTINEL);
  });

  it("shows a checking state (and no admin content) while the answer is in flight", async () => {
    hookState = { isPending: true, isError: false };
    await renderGate();

    expect(container.textContent).not.toContain(SENTINEL);
    expect(container.textContent).toContain("Checking admin access");
  });
});
