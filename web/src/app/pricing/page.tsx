import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Card, CardBody, Chip, SectionLabel } from "@/components/ui";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "SnapURL is free. The only thing we count is clicks — links, aliases, QR codes, edits, domains, team members and engagement data are unlimited and unmetered.",
};

const UNLIMITED = [
  "Short links and custom aliases",
  "Custom domains",
  "Dynamic QR codes",
  "Destination edits",
  "Tags and folders",
  "Team members and roles",
  "API keys and webhooks",
  "Engagement data and exports",
];

const METERED_ELSEWHERE = [
  "Number of links you can keep",
  "How many QR codes you generate",
  "Edits to where a link points",
  "Retained analytics history",
];

export default function PricingPage() {
  return (
    <div className="max-w-[1080px] mx-auto px-6 pb-[90px]">
      <SiteHeader />

      <header className="pt-[56px] pb-8 text-center">
        <div className="inline-flex items-center gap-2 px-[13px] py-[5px] rounded-full bg-accent-wash text-accent text-[12px] font-semibold mb-[22px]">
          <span className="w-[6px] h-[6px] rounded-full bg-current" />
          No card. No trial clock. No upsell.
        </div>
        <h1 className="text-[clamp(32px,5vw,54px)] leading-[1.05] font-extrabold tracking-[-0.03em]">
          Everyone else meters four things.
          <br />
          We count <em className="not-italic text-accent">one</em>.
        </h1>
        <p className="text-[16.5px] text-ink-2 max-w-[58ch] mx-auto mt-5">
          SnapURL is free right now, and the only number that moves is clicks. Links, aliases, QR codes, destination
          edits, custom domains, team members and engagement data are unlimited and unmetered on every plan.
        </p>
      </header>

      <div className="max-w-[460px] mx-auto mt-8">
        <Card className="shadow-[var(--shadow-2)]">
          <CardBody className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] tracking-[0.11em] uppercase text-ink-3">Free</div>
                <div className="font-display text-[40px] font-bold tracking-[-0.03em] leading-none mt-2">
                  $0
                  <span className="text-[15px] text-ink-3 font-medium tracking-normal"> / forever, for now</span>
                </div>
              </div>
              <Chip tone="good" dot>Live</Chip>
            </div>
            <p className="mt-4 text-[13px] text-ink-2 leading-[1.6]">
              We only count clicks. Everything you build around them is uncapped — and if that ever changes, it will be
              announced honestly, not slipped into a quota bar.
            </p>
            <ul className="mt-5 flex flex-col gap-[9px]">
              {UNLIMITED.map((item) => (
                <li key={item} className="flex items-start gap-[9px] text-[13px] text-ink-2">
                  <span className="mt-[1px] w-[17px] h-[17px] rounded-full bg-wash-good text-good grid place-items-center text-[10px] shrink-0">
                    ✓
                  </span>
                  <span className="leading-[1.5]">{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/register"
              className="mt-6 block text-center px-[18px] py-[11px] rounded-[var(--radius-sm)] bg-accent text-accent-ink font-semibold text-[14px]"
            >
              Start free
            </Link>
          </CardBody>
        </Card>
      </div>

      <section className="mt-24">
        <SectionLabel>What we count vs what gets metered elsewhere</SectionLabel>
        <div className="grid gap-3.5 md:grid-cols-2 mt-6">
          <Card>
            <CardBody className="p-5">
              <h3 className="text-[15px] font-bold mb-[6px]">The one thing we count</h3>
              <p className="m-0 text-[13.5px] text-ink-2 leading-[1.6]">
                Clicks. That is the single number attached to your workspace, and it is a plain count — not a cap filling
                toward a wall, not a gauge you have to buy your way past.
              </p>
              <div className="mt-4">
                <Chip tone="accent">Clicks · counted, never capped</Chip>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="p-5">
              <h3 className="text-[15px] font-bold mb-[6px]">What typical shorteners meter</h3>
              <ul className="flex flex-col gap-[9px]">
                {METERED_ELSEWHERE.map((item) => (
                  <li key={item} className="flex items-start gap-[9px] text-[13px] text-ink-2">
                    <span className="mt-[1px] w-[17px] h-[17px] rounded-full bg-surface-3 text-ink-3 grid place-items-center text-[11px] shrink-0">
                      ×
                    </span>
                    <span className="leading-[1.5]">{item}</span>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-4 text-[12px] text-ink-3 leading-[1.6]">
                Not here. None of these carry a limit in SnapURL.
              </p>
            </CardBody>
          </Card>
        </div>
      </section>

      <section className="mt-16">
        <Card>
          <CardBody className="p-6 md:flex md:items-center md:gap-8">
            <div className="flex-1">
              <h3 className="text-[16px] font-bold mb-[6px]">Want no bill at all? Self-host it.</h3>
              <p className="m-0 text-[13.5px] text-ink-2 leading-[1.6] max-w-[62ch]">
                SnapURL is MIT licensed. Run it on your own infrastructure and there is no SnapURL invoice, no plan and no
                one else in the loop — just your servers and your data. The cloud is the convenient option, not the only
                one.
              </p>
            </div>
            <div className="mt-5 md:mt-0 shrink-0">
              <Link
                href="/self-host"
                className="inline-block px-[18px] py-[10px] rounded-[var(--radius-sm)] bg-surface border border-line-2 text-ink-2 hover:text-ink hover:bg-surface-3 font-semibold text-[14px]"
              >
                Read the self-host guide
              </Link>
            </div>
          </CardBody>
        </Card>
      </section>

      <SiteFooter />
    </div>
  );
}
