import type { Metadata } from 'next';

import './globals.css';

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
    <html lang="en">
      <body className="min-h-screen bg-ink text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
