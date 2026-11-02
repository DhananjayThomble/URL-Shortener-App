import { describe, expect, it } from "vitest";
import { SamplingController, parseSampleRate } from "./sampling.js";

describe("parseSampleRate", () => {
  it("parses a valid 0..1 rate", () => {
    expect(parseSampleRate("0.25", 1)).toBe(0.25);
  });
  it("falls back when unset or blank", () => {
    expect(parseSampleRate(undefined, 0.5)).toBe(0.5);
    expect(parseSampleRate("", 0.5)).toBe(0.5);
  });
  it("clamps out-of-range and rejects nonsense", () => {
    expect(parseSampleRate("2", 1)).toBe(1);
    expect(parseSampleRate("-1", 1)).toBe(0);
    expect(parseSampleRate("abc", 0.3)).toBe(0.3);
  });
});

describe("SamplingController — shouldSend gate", () => {
  it("is off when no DSN was configured, regardless of runtime switch", () => {
    const c = new SamplingController({ dsnConfigured: false, errorsSampleRate: 1, tracesSampleRate: 0 });
    expect(c.shouldSend()).toBe(false);
    c.setRuntimeControls({ enabled: true });
    expect(c.shouldSend()).toBe(false);
    expect(c.sampleRate()).toBe(0);
  });

  it("is on with a DSN and off once the runtime switch (#1020) disables it", () => {
    const c = new SamplingController({ dsnConfigured: true, errorsSampleRate: 0.5, tracesSampleRate: 0 });
    expect(c.shouldSend()).toBe(true);
    expect(c.sampleRate()).toBe(0.5);
    c.setRuntimeControls({ enabled: false });
    expect(c.shouldSend()).toBe(false);
    expect(c.sampleRate()).toBe(0);
    c.setRuntimeControls({ enabled: true });
    expect(c.shouldSend()).toBe(true);
    expect(c.sampleRate()).toBe(0.5);
  });
});

describe("SamplingController — sample-rate cap can only lower the rate", () => {
  it("applies the runtime cap as a floor-min against the env ceiling", () => {
    const c = new SamplingController({ dsnConfigured: true, errorsSampleRate: 0.8, tracesSampleRate: 0 });
    c.setRuntimeControls({ sampleRateCap: 0.1 });
    expect(c.sampleRate()).toBe(0.1);
  });

  it("never raises the rate above the env ceiling even if the cap is higher", () => {
    const c = new SamplingController({ dsnConfigured: true, errorsSampleRate: 0.2, tracesSampleRate: 0 });
    c.setRuntimeControls({ sampleRateCap: 0.9 });
    expect(c.sampleRate()).toBe(0.2);
  });

  it("clamps a nonsense cap into range", () => {
    const c = new SamplingController({ dsnConfigured: true, errorsSampleRate: 0.5, tracesSampleRate: 0 });
    c.setRuntimeControls({ sampleRateCap: 5 });
    expect(c.sampleRate()).toBe(0.5); // min(0.5, 1)
    c.setRuntimeControls({ sampleRateCap: -1 });
    expect(c.sampleRate()).toBe(0); // min(0.5, 0)
  });

  it("merges partial runtime updates (enabled and cap set independently)", () => {
    const c = new SamplingController({ dsnConfigured: true, errorsSampleRate: 0.6, tracesSampleRate: 0 });
    c.setRuntimeControls({ sampleRateCap: 0.3 });
    c.setRuntimeControls({ enabled: false });
    expect(c.getRuntimeControls()).toEqual({ sampleRateCap: 0.3, enabled: false });
    c.setRuntimeControls({ enabled: true });
    expect(c.sampleRate()).toBe(0.3);
  });
});

describe("SamplingController — traces default to 0 (free tier safe)", () => {
  it("keeps traces at the env value and 0 when off", () => {
    const c = new SamplingController({ dsnConfigured: true, errorsSampleRate: 1, tracesSampleRate: 0 });
    expect(c.tracesSampleRate()).toBe(0);
    const c2 = new SamplingController({ dsnConfigured: true, errorsSampleRate: 1, tracesSampleRate: 0.05 });
    expect(c2.tracesSampleRate()).toBe(0.05);
    c2.setRuntimeControls({ enabled: false });
    expect(c2.tracesSampleRate()).toBe(0);
  });
});
