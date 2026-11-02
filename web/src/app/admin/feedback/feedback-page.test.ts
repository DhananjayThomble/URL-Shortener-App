// @vitest-environment happy-dom
//
// #997 — the admin "Report a problem" inbox UI.
//
// The mocked-api spec the issue asks for on the admin side: the list renders a
// row per report with its status, and changing a report's status drives
// useUpdateFeedback with the right { id, input }. The hooks are stubbed (the
// real API behaviour is proven by the api-package integration tests); the
// oracle is the rendered DOM and the mutation call the page makes.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedbackDetail, FeedbackPage } from "@snapurl/contract";

const listPage: FeedbackPage = {
  hasMore: false,
  rows: [
    {
      id: "f1",
      message: "The share button does nothing.",
      page: "/dashboard/links",
      userAgent: "UA",
      appVersion: "2.0.0",
      errorEventId: null,
      hasScreenshot: false,
      userId: null,
      workspaceId: null,
      workspaceName: null,
      reporterEmail: "visitor@example.com",
      status: "new",
      notes: null,
      createdAt: "2026-11-02T10:00:00Z",
      updatedAt: "2026-11-02T10:00:00Z",
    },
    {
      id: "f2",
      message: "Analytics chart blank.",
      page: "/analytics",
      userAgent: "UA2",
      appVersion: "2.0.0",
      errorEventId: "evt_1",
      hasScreenshot: true,
      userId: "u2",
      workspaceId: "w2",
      workspaceName: "Acme",
      reporterEmail: "owner@acme.example",
      status: "done",
      notes: "fixed",
      createdAt: "2026-11-02T09:00:00Z",
      updatedAt: "2026-11-02T09:30:00Z",
    },
  ],
};

const detail: FeedbackDetail = { ...listPage.rows[0]!, screenshot: null };

const updateMutate = vi.fn();
const toastShow = vi.fn();

vi.mock("@/lib/api/hooks", () => ({
  useAdminFeedback: () => ({ data: listPage, isPending: false, isError: false, refetch: vi.fn() }),
  useAdminFeedbackItem: () => ({ data: detail, isPending: false, isError: false, refetch: vi.fn() }),
  useUpdateFeedback: () => ({ mutate: updateMutate, isPending: false }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ show: toastShow }),
}));

import AdminFeedbackPage from "./page";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  updateMutate.mockClear();
  toastShow.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() => {
    root.render(createElement(AdminFeedbackPage));
  });
}

describe("AdminFeedbackPage (#997)", () => {
  it("renders a row per report with its message and status", () => {
    render();
    expect(container.textContent).toContain("The share button does nothing.");
    expect(container.textContent).toContain("Analytics chart blank.");
    // Status chips use the human labels.
    expect(container.textContent).toContain("New");
    expect(container.textContent).toContain("Done");
    // The reporter contact shows for a report that carried one.
    expect(container.textContent).toContain("visitor@example.com");
  });

  it("opens a report and changes its status through useUpdateFeedback", () => {
    render();
    // Open the first report's detail.
    const openButtons = Array.from(container.querySelectorAll("button")).filter((b) => b.textContent === "Open");
    expect(openButtons.length).toBeGreaterThan(0);
    act(() => openButtons[0]!.click());

    // The detail panel shows the full message + captured context.
    expect(container.textContent).toContain("Report detail");
    expect(container.textContent).toContain("/dashboard/links");

    // Change the status select to "in_progress".
    const statusSelect = Array.from(container.querySelectorAll("select")).find(
      (s) => s.getAttribute("aria-label") === "Change status",
    )!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      setter.call(statusSelect, "in_progress");
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Save.
    const saveBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save")!;
    act(() => saveBtn.click());

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [vars] = updateMutate.mock.calls[0]!;
    expect(vars).toMatchObject({ id: "f1", input: { status: "in_progress" } });
  });

  it("does not call the mutation when nothing changed (Save is a no-op)", () => {
    render();
    const openButtons = Array.from(container.querySelectorAll("button")).filter((b) => b.textContent === "Open");
    act(() => openButtons[0]!.click());
    const saveBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save")!;
    act(() => saveBtn.click());
    // Status unchanged (still "new") and notes untouched -> no mutation, a toast.
    expect(updateMutate).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalled();
  });
});
