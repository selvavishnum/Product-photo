import type { Metadata } from 'next';
import { Inter, Noto_Sans_Tamil, Plus_Jakarta_Sans } from 'next/font/google';

import './globals.css';

/**
 * Fonts are self-hosted by next/font at build time, not fetched from Google
 * at runtime. That matters for this audience specifically: the pages load on
 * patchy mobile connections, and a runtime font request is one more thing
 * that can hang before any text appears.
 *
 * `display: 'swap'` for the same reason -- text in a fallback face beats no
 * text at all.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

/**
 * Tamil has no fallback worth relying on. Without this the script renders in
 * whatever the device happens to have, which on a cheap Android phone is
 * often nothing -- and missing glyphs are silent, so the page looks fine in
 * testing and shows boxes to the person it was built for.
 */
const notoTamil = Noto_Sans_Tamil({
  subsets: ['tamil'],
  variable: '--font-noto-tamil',
  display: 'swap',
});

/**
 * SEO metadata is not decoration here. This product has to be findable by
 * shop owners searching in Tamil and English -- it was the main argument for
 * building the frontend as a real website rather than a Flutter web app.
 */
export const metadata: Metadata = {
  title: 'Ad Auto-Pilot - Facebook & Instagram ads for small shops',
  description:
    'Describe your shop. Get a ready-made ad poster, Tamil or English ad copy, and a local audience plan. Built for small businesses, not marketers.',
  openGraph: {
    title: 'Ad Auto-Pilot',
    description:
      'Ad posters and Tamil/English ad copy for small local businesses.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${inter.variable} ${notoTamil.variable}`}
    >
      <body className="min-h-screen bg-page font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
