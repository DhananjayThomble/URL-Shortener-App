import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SnapURL - URL Shortener',
  description: 'Create short, memorable links and track their performance with our powerful URL shortening service.',
  keywords: 'url shortener, link shortener, analytics, qr codes, custom domains',
  authors: [{ name: 'SnapURL Team' }],
  creator: 'SnapURL',
  publisher: 'SnapURL',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL('https://snapurl.com'),
  openGraph: {
    title: 'SnapURL - URL Shortener',
    description: 'Create short, memorable links and track their performance with our powerful URL shortening service.',
    url: 'https://snapurl.com',
    siteName: 'SnapURL',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SnapURL - URL Shortener',
    description: 'Create short, memorable links and track their performance with our powerful URL shortening service.',
    creator: '@snapurl',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: 'your-google-verification-code',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#3b82f6" />
        <meta name="color-scheme" content="light dark" />
        <link rel="icon" href="/favicon.ico" />
        {/* <link rel="apple-touch-icon" href="/apple-touch-icon.png" /> */}
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className={inter.className} suppressHydrationWarning>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}