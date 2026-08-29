import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Card, CardBody, Chip, SectionLabel } from "@/components/ui";

export const metadata: Metadata = {
  title: "Product",
  description:
    "Branded links, edge routing, cookieless analytics, dynamic QR codes and public link previews — built for people who care where their traffic goes.",
};

const FEATURES = [
  {
    icon: "◈",
    title: "Your domain, your links",
    body: "Bring any domain, get automatic SSL, and set root and 404 redirects. Add as many as you want — domains are never metered.",
    points: ["Custom domains with DNS verification", "Custom aliases and clean back-halves", "Password protection and expiry with a fallback destination", "Tags and folders to keep a big workspace tidy"],
  },
  {
    icon: "⇄",
    title: "Route by anything, at the edge",
    body: "Send India to the India store, iOS to the App Store, and split the rest for an A/B test. Rules evaluate in the redirect path, not in a browser.",
    points: ["Country, device and language routing", "Weighted A/B routing across destinations", "UTM metadata carried through automatically", "One link, many outcomes — changed whenever you like"],
  },
  {
    icon: "▩",
    title: "QR that stays correct",
    body: "Print it once, change where it points forever. The code on the poster never has to change because the destination lives with the link.",
    points: ["SVG and PNG export", "Foreground colour and error-correction level", "Optional logo in the centre", "Scans counted alongside clicks"],
  },
  {
    icon: "🛡",
    title: "Trust, made visible",
    body: "Anyone can add + to a short link to see exactly where it goes, who made it and what it sets, before they click.",
    points: ["Public link preview at /p/<slug>", "No cookies, no redirect interstitial", "Shows destination, owner and expiry", "Same honesty for the people who click as for you"],
  },
];

export default function ProductPage() {
  return (
    <div className="max-w-[1080px] mx-auto px-6 pb-[90px]">
      <SiteHeader />

      <header className="pt-[56px] pb-8 text-center">
        <div className="inline-flex items-center gap-2 px-[13px] py-[5px] rounded-full bg-accent-wash text-accent text-[12px] font-semibold mb-[22px]">
          <span className="w-[6px] h-[6px] rounded-full bg-current" />
          Everything below is on every plan
        </div>
        <h1 className="text-[clamp(32px,5vw,54px)] leading-[1.05] font-extrabold tracking-[-0.03em]">
          A link platform that
          <br />
          takes <em className="not-italic text-accent">your side</em>.
        </h1>
        <p className="text-[16.5px] text-ink-2 max-w-[58ch] mx-auto mt-5">
          Branded short links, edge routing, dynamic QR codes and analytics that set no cookies. Nothing here is a paid
          add-on and nothing here is metered except the clicks themselves.
        </p>
      </header>

      <div className="grid gap-3.5 md:grid-cols-2 mt-8">
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <CardBody className="p-5">
              <div className="w-[34px] h-[34px] rounded-[9px] bg-accent-wash text-accent grid place-items-center text-[16px] mb-[13px]">
                {f.icon}
              </div>
              <h3 className="text-[16px] font-bold mb-[6px]">{f.title}</h3>
              <p className="m-0 text-[13.5px] text-ink-2 leading-[1.6]">{f.body}</p>
              <ul className="mt-4 flex flex-col gap-[9px]">
                {f.points.map((p) => (
                  <li key={p} className="flex items-start gap-[9px] text-[13px] text-ink-2">
                    <span className="mt-[6px] w-[6px] h-[6px] rounded-full bg-accent shrink-0" />
                    <span className="leading-[1.5]">{p}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Analytics: anchored so the nav's Analytics item resolves to /product#analytics */}
      <section id="analytics" className="mt-24 scroll-mt-24">
        <SectionLabel>Analytics without cookies</SectionLabel>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] mt-6 items-start">
          <div>
            <h2 className="text-[clamp(24px,3.4vw,34px)] font-bold tracking-[-0.02em]">
              We measure the click, not the person.
            </h2>
            <p className="text-ink-2 mt-4 text-[14.5px] leading-[1.7]">
              You still see country, city, device, browser, referrer, conversions, QR scans and unique visitors. What you
              never see — because we never collect it — is a cookie, an IP address or anything left behind on the
              visitor&apos;s device.
            </p>
            <p className="text-ink-2 mt-4 text-[14.5px] leading-[1.7]">
              Unique visitors are counted with a hash that rotates daily and resets at 00:00 UTC, so a returning visitor on
              a fresh day is a fresh count. That is the honest cost of not tracking people across days, and we state it
              plainly rather than let you discover it.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Chip tone="good" dot>No tracking cookies</Chip>
              <Chip tone="good" dot>No IP stored</Chip>
              <Chip tone="accent">Daily-rotating hash</Chip>
              <Chip tone="accent">Server-side attribution</Chip>
            </div>
          </div>

          <div className="flex flex-col gap-3.5">
            <Card>
              <CardBody className="p-5">
                <h3 className="text-[14px] font-bold mb-[6px]">City without a coordinate</h3>
                <p className="m-0 text-[13px] text-ink-2 leading-[1.6]">
                  City comes from a CloudFront edge header — a name, never latitude and longitude. A city with fewer than
                  five clicks in the window folds into &ldquo;Other cities&rdquo; so the total still adds up but no single
                  click is ever pinned to a place. That five-click floor is a deliberate k-anonymity guard.
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="p-5">
                <h3 className="text-[14px] font-bold mb-[6px]">Tracking pixels are declined on principle</h3>
                <p className="m-0 text-[13px] text-ink-2 leading-[1.6]">
                  We do not drop a Meta or Google pixel into your redirects. Attribution is served server-side instead:
                  your own site reports a conversion with <span className="font-mono text-[12px] text-ink">POST /conversions</span>,
                  and <span className="font-mono text-[12px] text-ink">conversion.recorded</span> webhooks push it onward — no
                  third party on the visitor&apos;s device, and it keeps working when pixels are blocked.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </section>

      <div className="text-center mt-24">
        <h2 className="text-[clamp(24px,3.4vw,34px)] font-bold tracking-[-0.02em]">
          Start free. Change your mind later.
        </h2>
        <p className="text-ink-2 max-w-[52ch] mx-auto mt-3 text-[15px]">
          Your links, QR codes and data export cleanly whenever you want. Nothing here is designed to hold you hostage.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          <Link
            href="/register"
            className="inline-block px-[18px] py-[10px] rounded-[var(--radius-sm)] bg-accent text-accent-ink font-semibold text-[14px]"
          >
            Start free
          </Link>
          <Link
            href="/self-host"
            className="inline-block px-[18px] py-[10px] rounded-[var(--radius-sm)] bg-surface border border-line-2 text-ink-2 hover:text-ink hover:bg-surface-3 font-semibold text-[14px]"
          >
            Or self-host it
          </Link>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
