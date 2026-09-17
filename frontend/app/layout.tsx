import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WebEdge Solution',
  description: 'Hosting, domains and email in one place.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
