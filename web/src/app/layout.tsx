import type { Metadata } from "next";
import { Archivo, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import { Providers } from "./providers";
import { PREPAINT_SESSION_HINT } from "@/lib/session-hint";
import "./globals.css";

// Self-hosted at build time (next/font/google) — see docs/DECISIONS.md Part 6.
// Each family exposes a CSS variable that globals.css wires into the existing
// --font-* design tokens, so no component changes. Weights match what the old
// Google Fonts <link> requested; display:swap keeps the fallback-then-webfont
// behaviour for first paint, now served from the app's own origin (no reflow
// dependent on a third-party fetch, no IP disclosure to Google).
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
  variable: "--font-archivo",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-public-sans",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-ibm-plex-mono",
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
