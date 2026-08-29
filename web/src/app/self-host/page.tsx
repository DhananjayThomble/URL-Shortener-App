import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Card, CardBody, Chip, SectionLabel } from "@/components/ui";

export const metadata: Metadata = {
  title: "Self-host",
  description:
    "SnapURL is MIT licensed and self-hostable in one command. Own your data, export everything, no vendor lock-in, no tracking cookies.",
};

const REPO_URL = "https://github.com/DhananjayThomble/URL-Shortener-App";

const PRINCIPLES = [
  {
    icon: "∞",
    title: "Links that outlive a subscription",
    body: "A short link on a poster should still resolve years from now. Self-hosting means it does not depend on our servers, our billing, or us still being around.",
  },
  {
    icon: "⤓",
    title: "Export everything, always",
    body: "Your links, analytics and settings are yours to take out at any time. Export is a feature on every plan, not a retention lever.",
  },
  {
    icon: "⚿",
    title: "No vendor lock-in",
    body: "MIT licensed, standard Postgres, no closed core. If you outgrow the cloud or just prefer to run your own, the door is already open.",
  },
  {
    icon: "◔",
    title: "Built to run cheaply",
    body: "It leans on a queue's free tier instead of a paid cache, and reads geography from the CDN edge instead of licensing a database — so your bill stays small.",
  },
];

const CLOUD = [
  "Managed and updated for you",
  "Currently free — only clicks are counted",
  "Nothing to provision or patch",
  "Start in seconds with an email and password",
];

const SELFHOST = [
  "Runs on your own infrastructure",
  "No SnapURL bill and no SnapURL in the loop",
  "Your database, your backups, your control",
  "One command to bring the stack up",
];

export default function SelfHostPage() {
  return (
    <div className="max-w-[1080px] mx-auto px-6 pb-[90px]">
      <SiteHeader />

      <header className="pt-[56px] pb-8 text-center">
        <div className="inline-flex items-center gap-2 px-[13px] py-[5px] rounded-full bg-accent-wash text-accent text-[12px] font-semibold mb-[22px]">
          <span className="w-[6px] h-[6px] rounded-full bg-current" />
          MIT licensed · self-host in one command
        </div>
        <h1 className="text-[clamp(32px,5vw,54px)] leading-[1.05] font-extrabold tracking-[-0.03em]">
          Run it yourself.
          <br />
          Own <em className="not-italic text-accent">every part</em> of it.
        </h1>
        <p className="text-[16.5px] text-ink-2 max-w-[58ch] mx-auto mt-5">
          SnapURL is open source. Clone the repo, bring the stack up, and you have branded links, dynamic QR codes and
          cookieless analytics running entirely on your own infrastructure — with no one else in the loop.
        </p>
        <div className="mt-7 flex flex-wrap gap-3 justify-center">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-block px-[18px] py-[10px] rounded-[var(--radius-sm)] bg-accent text-accent-ink font-semibold text-[14px]"
          >
            Get the source on GitHub
          </a>
          <Link
            href="/register"
            className="inline-block px-[18px] py-[10px] rounded-[var(--radius-sm)] bg-surface border border-line-2 text-ink-2 hover:text-ink hover:bg-surface-3 font-semibold text-[14px]"
          >
            Or try the cloud
          </Link>
        </div>
      </header>

      <div className="grid gap-3.5 md:grid-cols-2 mt-8">
        {PRINCIPLES.map((p) => (
          <Card key={p.title}>
            <CardBody className="p-5">
              <div className="w-[34px] h-[34px] rounded-[9px] bg-accent-wash text-accent grid place-items-center text-[16px] mb-[13px]">
                {p.icon}
              </div>
              <h3 className="text-[15px] font-bold mb-[6px]">{p.title}</h3>
              <p className="m-0 text-[13.5px] text-ink-2 leading-[1.6]">{p.body}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <section className="mt-24">
        <SectionLabel>Cloud or self-host</SectionLabel>
        <div className="grid gap-3.5 md:grid-cols-2 mt-6">
          <Card>
            <CardBody className="p-6">
              <div className="flex items-center gap-2">
                <h3 className="text-[16px] font-bold">Cloud</h3>
                <Chip tone="accent">Managed by us</Chip>
              </div>
              <p className="mt-2 text-[13px] text-ink-2 leading-[1.6]">
                The convenient option. We run it, keep it current, and it is free today — the only thing counted is clicks.
              </p>
              <ul className="mt-5 flex flex-col gap-[9px]">
                {CLOUD.map((item) => (
                  <li key={item} className="flex items-start gap-[9px] text-[13px] text-ink-2">
                    <span className="mt-[1px] w-[17px] h-[17px] rounded-full bg-accent-wash text-accent grid place-items-center text-[10px] shrink-0">
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
          <Card>
            <CardBody className="p-6">
              <div className="flex items-center gap-2">
                <h3 className="text-[16px] font-bold">Self-host</h3>
                <Chip tone="good">You run it</Chip>
              </div>
              <p className="mt-2 text-[13px] text-ink-2 leading-[1.6]">
                Full control on your own hardware. There is no hosted plan to buy and no support contract to sign — the
                code and the docs are the product.
              </p>
              <ul className="mt-5 flex flex-col gap-[9px]">
                {SELFHOST.map((item) => (
                  <li key={item} className="flex items-start gap-[9px] text-[13px] text-ink-2">
                    <span className="mt-[1px] w-[17px] h-[17px] rounded-full bg-wash-good text-good grid place-items-center text-[10px] shrink-0">
                      ✓
                    </span>
                    <span className="leading-[1.5]">{item}</span>
                  </li>
                ))}
              </ul>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-6 block text-center px-[18px] py-[11px] rounded-[var(--radius-sm)] bg-surface border border-line-2 text-ink-2 hover:text-ink hover:bg-surface-3 font-semibold text-[14px]"
              >
                Read the repo
              </a>
            </CardBody>
          </Card>
        </div>
        <p className="text-center text-[12px] text-ink-3 mt-4 max-w-[62ch] mx-auto leading-[1.6]">
          Same code either way. The cloud is us running the open-source project for you; self-hosting is you running the
          exact same thing.
        </p>
      </section>

      <section className="mt-16">
        <Card>
          <CardBody className="p-6 text-center">
            <h3 className="text-[16px] font-bold mb-[6px]">Privacy is not a plan tier</h3>
            <p className="m-0 mx-auto max-w-[64ch] text-[13.5px] text-ink-2 leading-[1.7]">
              Whether you use the cloud or run it yourself, the redirect sets no tracking cookies, stores no IP for
              geography, and leaves nothing on the visitor&apos;s device. Those are mechanisms in the code, not promises in
              a contract — which is exactly why you can read them and check.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              <Chip tone="good" dot>No tracking cookies</Chip>
              <Chip tone="good" dot>No IP stored</Chip>
              <Chip tone="accent">Read the source</Chip>
            </div>
          </CardBody>
        </Card>
      </section>

      <SiteFooter />
    </div>
  );
}
