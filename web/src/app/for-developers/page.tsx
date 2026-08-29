import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Card, CardBody, Chip, SectionLabel } from "@/components/ui";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "A typed REST API, SDKs, real-time webhooks, a CLI and an MCP server. SnapURL is MIT licensed and built so your agents can ship links too.",
};

const REPO_URL = "https://github.com/DhananjayThomble/URL-Shortener-App";

const SURFACES = [
  {
    icon: "⌘",
    title: "REST API",
    body: "A typed, versioned HTTP API. Create a link, read its analytics, manage domains — the dashboard uses the same endpoints you do.",
  },
  {
    icon: "◇",
    title: "Typed SDKs",
    body: "End-to-end types shared with the API contract, so a link you create in code has the same shape the dashboard renders.",
  },
  {
    icon: "⇉",
    title: "Real-time webhooks",
    body: "Subscribe to events like conversion.recorded and get them pushed to your endpoint the moment they happen.",
  },
  {
    icon: "▸",
    title: "CLI",
    body: "Script link creation and exports from your terminal or CI, using the same API keys as everything else.",
  },
  {
    icon: "✦",
    title: "MCP server",
    body: "Expose SnapURL to your agents over the Model Context Protocol so they can create and route links themselves.",
  },
  {
    icon: "⚿",
    title: "API keys",
    body: "Scoped keys per workspace. Rotate them, revoke them, and attribute conversions to the key that reported them.",
  },
];

const CREATE_SNIPPET = `curl -X POST "$SNAPURL_API_URL/links" \\
  -H "Authorization: Bearer $SNAPURL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "destination": "https://acme.com/spring-2026",
    "slug": "spring-sale"
  }'

# → 201 Created — returns the Link, including its slug and short URL`;

const WEBHOOK_SNIPPET = `POST https://your-app.example.com/webhooks/snapurl

{
  "event": "conversion.recorded",
  "data": {
    "linkId": "...",
    "value": { "amount": 4900, "currency": "USD" }
  }
}`;

export default function ForDevelopersPage() {
  return (
    <div className="max-w-[1080px] mx-auto px-6 pb-[90px]">
      <SiteHeader />

      <header className="pt-[56px] pb-8 text-center">
        <div className="inline-flex items-center gap-2 px-[13px] py-[5px] rounded-full bg-accent-wash text-accent text-[12px] font-semibold mb-[22px]">
          <span className="w-[6px] h-[6px] rounded-full bg-current" />
          MIT licensed · read the source
        </div>
        <h1 className="text-[clamp(32px,5vw,54px)] leading-[1.05] font-extrabold tracking-[-0.03em]">
          Links are an <em className="not-italic text-accent">API call</em>,
          <br />
          not a form field.
        </h1>
        <p className="text-[16.5px] text-ink-2 max-w-[58ch] mx-auto mt-5">
          A typed REST API, SDKs, real-time webhooks, a CLI and an MCP server — the same surfaces the dashboard is built
          on. Automate everything, and let your agents ship links too.
        </p>
      </header>

      <div className="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(238px,1fr))] mt-8">
        {SURFACES.map((s) => (
          <Card key={s.title}>
            <CardBody className="p-5">
              <div className="w-[34px] h-[34px] rounded-[9px] bg-accent-wash text-accent grid place-items-center text-[16px] mb-[13px]">
                {s.icon}
              </div>
              <h3 className="text-[15px] font-bold mb-[6px]">{s.title}</h3>
              <p className="m-0 text-[13.5px] text-ink-2 leading-[1.6]">{s.body}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <section className="mt-24">
        <SectionLabel>Create a link</SectionLabel>
        <div className="grid gap-3.5 lg:grid-cols-2 mt-6 items-start">
          <div>
            <h2 className="text-[clamp(22px,3vw,30px)] font-bold tracking-[-0.02em]">
              One request, one link.
            </h2>
            <p className="text-ink-2 mt-4 text-[14px] leading-[1.7]">
              Authenticate with a workspace API key and POST a destination. You get back the full link — the same object
              the dashboard shows — so you can print its QR or edit where it points later without changing the printed
              code.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Chip tone="accent">Bearer API key</Chip>
              <Chip>Returns a Link</Chip>
            </div>
          </div>
          <div className="rounded-[var(--radius)] border border-line bg-surface-2 overflow-hidden shadow-[var(--shadow-1)]">
            <div className="flex items-center gap-2 px-4 py-[10px] border-b border-line bg-surface-3">
              <span className="font-mono text-[10px] tracking-[0.11em] uppercase text-ink-3">POST /links</span>
            </div>
            <pre className="m-0 p-4 overflow-x-auto text-[12px] leading-[1.6] font-mono text-ink-2">
              <code>{CREATE_SNIPPET}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="mt-16">
        <SectionLabel>React to what happens next</SectionLabel>
        <div className="grid gap-3.5 lg:grid-cols-2 mt-6 items-start">
          <div className="rounded-[var(--radius)] border border-line bg-surface-2 overflow-hidden shadow-[var(--shadow-1)]">
            <div className="flex items-center gap-2 px-4 py-[10px] border-b border-line bg-surface-3">
              <span className="font-mono text-[10px] tracking-[0.11em] uppercase text-ink-3">Webhook delivery</span>
            </div>
            <pre className="m-0 p-4 overflow-x-auto text-[12px] leading-[1.6] font-mono text-ink-2">
              <code>{WEBHOOK_SNIPPET}</code>
            </pre>
          </div>
          <div>
            <h2 className="text-[clamp(22px,3vw,30px)] font-bold tracking-[-0.02em]">
              Attribution, server-side.
            </h2>
            <p className="text-ink-2 mt-4 text-[14px] leading-[1.7]">
              Your own site reports a conversion with <span className="font-mono text-[12px] text-ink">POST /conversions</span>,
              scoped to the API key that owns it. SnapURL pushes a <span className="font-mono text-[12px] text-ink">conversion.recorded</span> webhook
              onward, so your analytics attribute the click without a third-party pixel on anyone&apos;s device.
            </p>
            <p className="text-ink-2 mt-4 text-[14px] leading-[1.7]">
              It keeps working for the growing share of visitors whose browsers block pixels outright.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-16">
        <Card>
          <CardBody className="p-6 md:flex md:items-center md:gap-8">
            <div className="flex-1">
              <h3 className="text-[16px] font-bold mb-[6px]">Open source, all the way down</h3>
              <p className="m-0 text-[13.5px] text-ink-2 leading-[1.6] max-w-[64ch]">
                The API, the redirect service and this dashboard are MIT licensed. Read exactly how a click is recorded,
                fork it, or run the whole thing yourself. There is no closed core waiting to bill you.
              </p>
            </div>
            <div className="mt-5 md:mt-0 shrink-0">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-block px-[18px] py-[10px] rounded-[var(--radius-sm)] bg-surface border border-line-2 text-ink-2 hover:text-ink hover:bg-surface-3 font-semibold text-[14px]"
              >
                View on GitHub
              </a>
            </div>
          </CardBody>
        </Card>
      </section>

      <div className="text-center mt-24">
        <h2 className="text-[clamp(24px,3.4vw,34px)] font-bold tracking-[-0.02em]">Build with it today.</h2>
        <p className="text-ink-2 max-w-[52ch] mx-auto mt-3 text-[15px]">
          Create a workspace, mint an API key and start shipping links from code — or clone the repo and run it yourself.
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
            Self-host it
          </Link>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
