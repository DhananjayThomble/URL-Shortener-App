// @vitest-environment happy-dom
//
// #868 — prove the mount-animation acceptance: with reduced motion requested,
// every <Area> in the traffic chart is told not to animate
// (isAnimationActive={false}); with motion allowed, it animates
// (isAnimationActive={true}).
//
// Oracle: the prop TrafficChart passes to <Area>, captured from a stubbed
// recharts, NOT the rendered SVG. ResponsiveContainer measures width 0 under
// happy-dom and paints no chart, so the DOM cannot witness the <Area>. The
// component's own prop is the implementation-independent truth here.

// React requires this flag to run act() outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture every props object handed to <Area>. The other recharts primitives
// become transparent pass-throughs so the Area elements are actually created.
const areaProps: Array<Record<string, unknown>> = [];

vi.mock("recharts", () => {
  const passthrough =
    (tag: string) =>
    ({ children }: { children?: unknown } = {}) =>
      createElement("div", { "data-recharts": tag }, children as never);
  return {
    ResponsiveContainer: passthrough("ResponsiveContainer"),
    AreaChart: passthrough("AreaChart"),
    CartesianGrid: passthrough("CartesianGrid"),
    XAxis: passthrough("XAxis"),
    Tooltip: passthrough("Tooltip"),
    Area: (props: Record<string, unknown>) => {
      areaProps.push(props);
      return null;
    },
  };
});

// Imported AFTER the mock is registered (vi.mock is hoisted, so this is fine).
import { TrafficChart } from "./index";
import type { TimeseriesPoint } from "@/lib/api/types";

const DATA = [
  { date: "2026-01-01", clicks: 1, unique: 1 },
  { date: "2026-01-02", clicks: 5, unique: 3 },
] as unknown as TimeseriesPoint[];

async function renderChart() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(TrafficChart, { data: DATA, series: ["clicks", "unique"] }));
  });
  return async () => {
    await act(async () => root.unmount());
    host.remove();
  };
}

beforeEach(() => {
  areaProps.length = 0;
  document.documentElement.classList.remove("reduce-motion");
  // Neutral matchMedia: reduced-motion OFF by default for this suite.
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
});

afterEach(() => {
  document.documentElement.classList.remove("reduce-motion");
  vi.restoreAllMocks();
});

describe("TrafficChart mount animation vs reduced motion (#868)", () => {
  it("animates every <Area> when motion is allowed", async () => {
    const cleanup = await renderChart();

    expect(areaProps.length).toBe(2); // one per series — guards the enumeration
    for (const p of areaProps) {
      expect(p.isAnimationActive).toBe(true);
    }

    await cleanup();
  });

  it("disables animation on every <Area> when the reduce-motion class is set", async () => {
    document.documentElement.classList.add("reduce-motion");
    const cleanup = await renderChart();

    expect(areaProps.length).toBe(2);
    for (const p of areaProps) {
      expect(p.isAnimationActive).toBe(false);
    }

    await cleanup();
  });

  it("disables animation on every <Area> when the media query requests reduced motion", async () => {
    window.matchMedia = ((query: string) =>
      ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    const cleanup = await renderChart();

    expect(areaProps.length).toBe(2);
    for (const p of areaProps) {
      expect(p.isAnimationActive).toBe(false);
    }

    await cleanup();
  });
});
