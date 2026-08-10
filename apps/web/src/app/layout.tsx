import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ottodot Trial Booking',
  description: 'Trial class booking demo for Ottodot',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
