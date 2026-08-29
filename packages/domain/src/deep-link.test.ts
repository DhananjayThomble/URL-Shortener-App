import { describe, expect, it } from "vitest";
import { DEEP_LINK_HOSTS, buildDeepLink } from "./deep-link.js";

const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("buildDeepLink", () => {
  describe("when it must not interfere", () => {
    it("leaves the destination alone when deep linking is off", () => {
      expect(buildDeepLink(YT, "android", false)).toBe(YT);
    });

    it("leaves iOS alone — the https URL is already a Universal Link", () => {
      // Attempting a custom scheme here trades a silent success for Safari's
      // "Cannot Open Page" whenever the app is absent.
      expect(buildDeepLink(YT, "ios", true)).toBe(YT);
    });

    it("leaves desktop alone, because there is no app to open", () => {
      expect(buildDeepLink(YT, "desktop", true)).toBe(YT);
    });

    it("leaves an unknown device alone", () => {
      expect(buildDeepLink(YT, null, true)).toBe(YT);
      expect(buildDeepLink(YT, "mobile", true)).toBe(YT);
    });

    it("leaves a host with no known app alone", () => {
      const url = "https://example.com/some/page";
      expect(buildDeepLink(url, "android", true)).toBe(url);
    });

    it("leaves an unparseable destination alone rather than throwing", () => {
      expect(buildDeepLink("not a url", "android", true)).toBe("not a url");
    });

    it("refuses to build an intent from a non-web scheme", () => {
      const url = "mailto:someone@example.com";
      expect(buildDeepLink(url, "android", true)).toBe(url);
    });
  });

  describe("on Android", () => {
    it("builds an intent carrying the original URL as the fallback", () => {
      const out = buildDeepLink(YT, "android", true);
      expect(out.startsWith("intent://www.youtube.com/watch?v=dQw4w9WgXcQ#Intent;")).toBe(true);
      expect(out).toContain("scheme=https");
      expect(out).toContain("package=com.google.android.youtube");
      expect(out).toContain(`S.browser_fallback_url=${encodeURIComponent(YT)}`);
      expect(out.endsWith(";end")).toBe(true);
    });

    it("always leaves a way through — the fallback is the destination itself", () => {
      // The property the whole feature rests on: app installed or not, the
      // visitor lands somewhere deliberate.
      const out = buildDeepLink(YT, "android", true);
      const fallback = decodeURIComponent(out.split("S.browser_fallback_url=")[1]!.replace(/;end$/, ""));
      expect(fallback).toBe(YT);
    });

    it("keeps the query string, which is where the content id usually lives", () => {
      const out = buildDeepLink("https://open.spotify.com/track/abc?si=xyz", "android", true);
      expect(out).toContain("intent://open.spotify.com/track/abc?si=xyz#Intent;");
      expect(out).toContain("package=com.spotify.music");
    });

    it("matches subdomains without needing an entry for each", () => {
      expect(buildDeepLink("https://open.spotify.com/x", "android", true)).toContain("com.spotify.music");
      expect(buildDeepLink("https://m.youtube.com/x", "android", true)).toContain("com.google.android.youtube");
      expect(buildDeepLink("https://youtube.com/x", "android", true)).toContain("com.google.android.youtube");
    });

    it("does not match a lookalike host that merely ends with the name", () => {
      // notyoutube.com must not resolve to YouTube's package.
      expect(buildDeepLink("https://notyoutube.com/x", "android", true)).toBe("https://notyoutube.com/x");
      expect(buildDeepLink("https://evil-x.com/x", "android", true)).toBe("https://evil-x.com/x");
    });

    it("sends X and Twitter to the same app", () => {
      expect(buildDeepLink("https://x.com/a/status/1", "android", true)).toContain("com.twitter.android");
      expect(buildDeepLink("https://twitter.com/a/status/1", "android", true)).toContain("com.twitter.android");
    });

    it("percent-encodes the fallback so its query cannot terminate the intent", () => {
      // An unencoded ";" or "&" in the fallback would truncate the intent and
      // strand the visitor — the exact failure this feature must not have.
      const tricky = "https://www.youtube.com/watch?v=a&list=b;end";
      const out = buildDeepLink(tricky, "android", true);
      expect(out.endsWith(";end")).toBe(true);
      const fallback = decodeURIComponent(out.split("S.browser_fallback_url=")[1]!.replace(/;end$/, ""));
      expect(fallback).toBe(tricky);
    });
  });

  it("publishes the hosts it knows, so the dashboard can name them", () => {
    expect(DEEP_LINK_HOSTS).toContain("youtube.com");
    expect(DEEP_LINK_HOSTS.length).toBeGreaterThan(5);
  });
});
