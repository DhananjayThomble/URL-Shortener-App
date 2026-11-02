// @vitest-environment happy-dom
//
// #997 — the in-app "Report a problem" control.
//
// The dialog's job is to collect free text (+ an optional screenshot), attach
// the page and app version automatically, and POST them through
// useSubmitFeedback — working both from the app shell (a signed-in user) and
// from an error page (which threads Next's error digest through as the
// error-tracking event id). The mocked-api spec the issue asks for: we stub
// useSubmitFeedback and assert the EXACT payload the component sends and the
// success state it renders, for a shell submit and an error-page submit.
//
// The oracle is the submitted input object and the resulting DOM, not the
// network — the API side is proven by the api-package integration tests.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The mutation the dialog drives, swapped per test. `mutate` records the input
   and, by default, invokes the success callback so the "sent" state renders. */
let lastInput: unknown;
let mutateImpl: (input: unknown, opts?: { onSuccess?: () => void }) => void;
let mutationState: { isPending: boolean; isError: boolean; error?: unknown };

vi.mock("@/lib/api/hooks", () => ({
  useSubmitFeedback: () => ({
    mutate: (input: unknown, opts?: { onSuccess?: () => void }) => mutateImpl(input, opts),
    ...mutationState,
  }),
}));

// NEXT_PUBLIC_APP_VERSION is inlined at build; set it so the "attach app
// version" assertion has a known value.
process.env.NEXT_PUBLIC_APP_VERSION = "9.9.9-test";

import { ReportProblemButton } from "./report-problem";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  lastInput = undefined;
  mutationState = { isPending: false, isError: false };
  mutateImpl = (input, opts) => {
    lastInput = input;
    opts?.onSuccess?.();
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // happy-dom gives window.location a pathname; pin it so the captured page is
  // deterministic.
  window.history.replaceState({}, "", "/dashboard/links?x=1");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function render(props: Record<string, unknown> = {}) {
  act(() => {
    root.render(createElement(ReportProblemButton, props));
  });
}

function openDialog() {
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="report-problem-trigger"]')!;
  act(() => trigger.click());
}

function typeInto(el: HTMLTextAreaElement, value: string) {
  // React tracks the value; set it through the native setter so onChange fires.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submitForm() {
  const form = container.querySelector("form")!;
  act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

describe("ReportProblemButton (#997)", () => {
  it("submits free text with the page and app version attached (app-shell path)", () => {
    render();
    openDialog();

    const textarea = container.querySelector("textarea")!;
    typeInto(textarea, "The share button does nothing.");
    submitForm();

    expect(lastInput).toEqual({
      message: "The share button does nothing.",
      page: "/dashboard/links?x=1",
      appVersion: "9.9.9-test",
    });
    // The success state renders after onSuccess fired.
    expect(container.querySelector('[data-testid="report-problem-done"]')).not.toBeNull();
    expect(container.textContent).toContain("your report was sent");
  });

  it("threads an error-page errorEventId through to the submission", () => {
    render({ context: { errorEventId: "digest-abc123" } });
    openDialog();
    typeInto(container.querySelector("textarea")!, "Crashed on save.");
    submitForm();

    expect(lastInput).toMatchObject({
      message: "Crashed on save.",
      errorEventId: "digest-abc123",
    });
  });

  it("trims the message and refuses a submit under 3 chars (no mutate)", () => {
    render();
    openDialog();
    typeInto(container.querySelector("textarea")!, "  ab  ");
    submitForm();
    // Below the floor: the component must not call the mutation.
    expect(lastInput).toBeUndefined();
    expect(container.querySelector('[data-testid="report-problem-done"]')).toBeNull();
  });

  it("works signed-out: the same control submits with no identity in the body", () => {
    // Signed-out is indistinguishable at this layer — the hook sends the bearer
    // only if one exists. The component never puts identity in the body, so the
    // payload carries only the message + captured context either way.
    render();
    openDialog();
    typeInto(container.querySelector("textarea")!, "Signed-out visitor report.");
    submitForm();
    expect(lastInput).toEqual({
      message: "Signed-out visitor report.",
      page: "/dashboard/links?x=1",
      appVersion: "9.9.9-test",
    });
    // No reporterEmail/userId/workspaceId in the body — identity is the API's job.
    expect(Object.keys(lastInput as object).sort()).toEqual(["appVersion", "message", "page"]);
  });

  it("surfaces a submit error and does not show the sent state", () => {
    mutateImpl = (input) => {
      lastInput = input;
      // no onSuccess — simulate a failed submit
    };
    mutationState = { isPending: false, isError: true, error: new Error("Network down") };
    render();
    openDialog();
    typeInto(container.querySelector("textarea")!, "This will fail to send.");
    submitForm();
    expect(container.querySelector('[data-testid="report-problem-done"]')).toBeNull();
    expect(container.textContent).toContain("Network down");
  });
});
