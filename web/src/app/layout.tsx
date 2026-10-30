import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "./providers";
import { PREPAINT_SESSION_HINT } from "@/lib/session-hint";
import "./globals.css";

// Self-hosted via next/font/local with OFL woff2 vendored under ./fonts — see
// docs/DECISIONS.md Part 6. next/font/local reads the files off disk at build
// time and performs NO network fetch (unlike next/font/google, whose build-time
// fetch to fonts.googleapis.com is blocked on CI runners), so the build is
// hermetic. Each family exposes a CSS variable that globals.css wires into the
// existing --font-* design tokens, so no component changes. Weights match what
// the old Google Fonts <link> requested; display:swap paints a fallback first
// and swaps in the self-hosted face — now same-origin, no third-party request,
// no IP disclosure to Google. adjustFontFallback sizes the fallback metrics to
// the webfont so the swap does not shift layout.
const archivo = localFont({
  src: [
    { path: "./fonts/archivo-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/archivo-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/archivo-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/archivo-800.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  variable: "--font-archivo",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
  adjustFontFallback: "Arial",
});

const publicSans = localFont({
  src: [
    { path: "./fonts/public-sans-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/public-sans-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/public-sans-600.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-public-sans",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
  adjustFontFallback: "Arial",
});

const ibmPlexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-600.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-ibm-plex-mono",
  fallback: ["ui-monospace", "monospace"],
  // No size-adjusted fallback for mono: adjustFontFallback only knows Arial /
  // Times New Roman metrics, neither of which models a monospace face, so a
  // size-adjust there would be wrong. ui-monospace is the fallback.
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: { default: "SnapURL", template: "%s · SnapURL" },
  description:
    "Short links that outlive your subscription. Branded links, dynamic QR codes and analytics that set no cookies.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${publicSans.variable} ${ibmPlexMono.variable}`}
    >
      <head>
        {/* Applies the saved appearance before first paint so the page never
            flashes the default accent or the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
var s=JSON.parse(localStorage.getItem('snapurl.appearance')||'{}');
var r=document.documentElement;
if(s.mode){r.setAttribute('data-theme',s.mode)}
var A={Cobalt:['#1D59C7','#6FA8FF'],Magenta:['#D6156A','#FF5C9D'],Pine:['#0B7A6E','#3FD6BE'],Ember:['#C2410C','#FF9557'],Iris:['#5B4BC4','#9C8CFF'],Mono:['#1A1F27','#E9EEF4']};
var a=A[s.accent||'Cobalt']||A.Cobalt;
var dark=s.mode?s.mode==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
var c=dark?a[1]:a[0];var n=parseInt(c.slice(1),16);
r.style.setProperty('--accent',c);r.style.setProperty('--accent-2',c);
r.style.setProperty('--accent-wash','rgb('+((n>>16)&255)+' '+((n>>8)&255)+' '+(n&255)+' / '+(dark?0.16:0.1)+')');
r.style.setProperty('--accent-ink',dark?'#06152B':'#FFFFFF');
if(s.density)r.style.setProperty('--density',s.density);
if(s.radius){r.style.setProperty('--radius',s.radius);var p=parseInt(s.radius,10);r.style.setProperty('--radius-sm',p>2?Math.max(4,p-3)+'px':'2px')}
if(s.reduceMotion)r.classList.add('reduce-motion');
}catch(e){}})();${PREPAINT_SESSION_HINT}`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
