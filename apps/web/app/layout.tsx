import '@fontsource-variable/ibm-plex-sans/index.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource-variable/source-serif-4/index.css';
import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'Venue Cover', template: '%s · Venue Cover' },
  description:
    'A showcase platform for event liability insurance on venue rentals: classification with a person in the loop, pricing, policies, reports and partner APIs.',
};

// Every page shows live operational data, so nothing is prerendered or cached.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
