import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SnapURL", template: "%s · SnapURL" },
  description:
    "Short links that outlive your subscription. Branded links, dynamic QR codes and analytics that set no cookies.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
        {/* Applies the saved appearance before first paint so the page never
            flashes the default accent or the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
var s=JSON.parse(localStorage.getItem('snapurl.appearance')||'{}');
var r=document.documentElement;
if(s.mode){r.setAttribute('data-theme',s.mode)}
var A={Cobalt:['#1F5FD4','#6FA8FF'],Magenta:['#D6156A','#FF5C9D'],Pine:['#0B7A6E','#3FD6BE'],Ember:['#C2410C','#FF9557'],Iris:['#5B4BC4','#9C8CFF'],Mono:['#1A1F27','#E9EEF4']};
var a=A[s.accent||'Cobalt']||A.Cobalt;
var dark=s.mode?s.mode==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
var c=dark?a[1]:a[0];var n=parseInt(c.slice(1),16);
r.style.setProperty('--accent',c);r.style.setProperty('--accent-2',c);
r.style.setProperty('--accent-wash','rgb('+((n>>16)&255)+' '+((n>>8)&255)+' '+(n&255)+' / '+(dark?0.16:0.1)+')');
r.style.setProperty('--accent-ink',dark?'#06152B':'#FFFFFF');
if(s.density)r.style.setProperty('--density',s.density);
if(s.radius){r.style.setProperty('--radius',s.radius);var p=parseInt(s.radius,10);r.style.setProperty('--radius-sm',p>2?Math.max(4,p-3)+'px':'2px')}
if(s.reduceMotion)r.classList.add('reduce-motion');
}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
