import Link from "next/link";

const FEATURES = [
  { icon: "◈", title: "Your domain, your links", body: "Bring any domain, get automatic SSL, and set root and 404 redirects. As many as you want — domains aren't metered." },
  { icon: "⇄", title: "Route by anything", body: "Send India to the India store, iOS to the App Store, and split the rest 50/50 for an A/B test. Rules run at the edge." },
  { icon: "▤", title: "Analytics without cookies", body: "Country, city, device, browser, referrer and conversions — measured with a daily-rotating hash. No IP stored, nothing left on the visitor's device." },
  { icon: "▩", title: "QR that stays correct", body: "Print it once, change where it points forever. SVG, PDF and EPS export, with your logo in the middle." },
  { icon: "🛡", title: "Trust, made visible", body: "Anyone can add + to a short link to see exactly where it goes, who made it and what it sets, before clicking." },
  { icon: "⌘", title: "Built for automation", body: "REST API, typed SDKs, real-time webhooks, a CLI and an MCP server. Your agents can ship links too." },
];

export default function LandingPage() {
  return (
    <div className="max-w-[1080px] mx-auto px-6 pb-[90px]">
      <nav className="flex items-center gap-6 py-[22px] flex-wrap">
        <Link href="/" className="flex items-center gap-[9px]">
          <span className="w-[27px] h-[27px] rounded-[7px] bg-accent text-accent-ink grid place-items-center font-display font-extrabold text-[15px]">
            S
          </span>
          <b className="font-display text-[16px] font-bold tracking-[-0.02em]">SnapURL</b>
        </Link>
        <div className="hidden md:flex gap-[22px] ml-5 text-[13.5px] text-ink-2">
          {["Product", "Analytics", "Developers", "Self-host", "Pricing"].map((l) => (
            <span key={l} className="hover:text-ink cursor-pointer">
              {l}
            </span>
          ))}
        </div>
        <div className="ml-auto flex gap-[9px] items-center">
          <Link
            href="/login"
            className="px-[13px] py-[7px] rounded-[var(--radius-sm)] text-[13px] font-semibold text-ink-2 hover:bg-surface-3 hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="px-[13px] py-[7px] rounded-[var(--radius-sm)] text-[13px] font-semibold bg-accent text-accent-ink hover:bg-accent-2"
          >
            Start free
          </Link>
        </div>
      </nav>

      <header className="pt-[66px] pb-10 text-center">
        <div className="inline-flex items-center gap-2 px-[13px] py-[5px] rounded-full bg-accent-wash text-accent text-[12px] font-semibold mb-[22px]">
          <span className="w-[6px] h-[6px] rounded-full bg-current" />
          MIT licensed · self-host in one command
        </div>
        <h1 className="text-[clamp(38px,6.4vw,68px)] leading-[1.03] font-extrabold tracking-[-0.032em]">
          Short links that
          <br />
          outlive your <em className="not-italic text-accent">subscription</em>.
        </h1>
        <p className="text-[17.5px] text-ink-2 max-w-[56ch] mx-auto mt-5">
          Branded links, dynamic QR codes and analytics that set no cookies — on infrastructure you can run yourself. No
          interstitial ads. No scan caps. One quota, and it only counts clicks.
        </p>

        <div className="max-w-[640px] mx-auto mt-[34px] bg-surface border border-line-2 rounded-[14px] p-[9px] flex flex-col sm:flex-row gap-[9px] shadow-[var(--shadow-2)] text-left">
          <input
            defaultValue="https://acme.com/collections/spring-2026?utm_source=instagram"
            spellCheck={false}
            className="flex-1 bg-transparent border-none px-[11px] py-[9px] text-[14.5px] text-ink focus:outline-none min-w-0"
            aria-label="URL to shorten"
          />
          <Link
            href="/register"
            className="px-[18px] py-[9px] rounded-[var(--radius-sm)] bg-accent text-accent-ink font-semibold text-[13px] text-center whitespace-nowrap"
          >
            Shorten
          </Link>
        </div>

        <div className="max-w-[640px] mx-auto mt-[11px] flex items-center gap-3 px-[15px] py-[13px] bg-surface border border-good rounded-[11px] shadow-[var(--shadow-1)] text-left">
          <span className="w-6 h-6 rounded-full bg-wash-good text-good grid place-items-center text-[12px] shrink-0">
            ✓
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[15px] font-semibold">
              <span className="text-ink-3">snap.to/</span>
              <span className="text-accent">spring-sale</span>
            </div>
            <div className="text-[11.5px] text-ink-3 mt-[2px]">
              no cookies set
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-[26px] flex-wrap mt-[26px] text-[12.5px] text-ink-3">
          {["No tracking cookies", "Export everything, always", "Free tier that doesn't shrink"].map(
            (t) => (
              <b key={t} className="flex items-center gap-[7px] font-medium">
                <span className="w-[6px] h-[6px] rounded-full bg-good" />
                {t}
              </b>
            ),
          )}
        </div>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(238px,1fr))] gap-3.5 mt-[66px]">
        {FEATURES.map((f) => (
          <div key={f.title} className="bg-surface border border-line rounded-[var(--radius)] p-5 shadow-[var(--shadow-1)]">
            <div className="w-[34px] h-[34px] rounded-[9px] bg-accent-wash text-accent grid place-items-center text-[16px] mb-[13px]">
              {f.icon}
            </div>
            <h3 className="text-[15px] font-bold mb-[6px]">{f.title}</h3>
            <p className="m-0 text-[13.5px] text-ink-2 leading-[1.6]">{f.body}</p>
          </div>
        ))}
      </div>

      <div className="text-center mt-20">
        <h2 className="text-[clamp(26px,3.6vw,36px)] font-bold">
          Everyone else meters four things.
          <br />
          We count one.
        </h2>
        <p className="text-ink-2 max-w-[54ch] mx-auto mt-3 text-[15.5px]">
          Links, QR codes, destination edits and &ldquo;engagement data&rdquo; are unlimited on every plan. The only
          number that moves is clicks.
        </p>
        <Link
          href="/register"
          className="inline-block mt-6 px-[18px] py-[10px] rounded-[var(--radius-sm)] bg-accent text-accent-ink font-semibold text-[14px]"
        >
          Start free
        </Link>
      </div>
    </div>
  );
}
