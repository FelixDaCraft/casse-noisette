import type { Metadata, Viewport } from 'next';
import { Inter, Fraunces } from 'next/font/google';
import './globals.css';
import RegisterSW from './RegisterSW';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Collage — 4ème circo 44',
  description: 'Itinéraires de collage — 4ème circonscription de Loire-Atlantique',
  manifest: '/manifest.webmanifest?v=2',
  icons: {
    icon: [
      { url: '/favicon.ico?v=2', sizes: 'any' },
      { url: '/icon-32.png?v=2', type: 'image/png', sizes: '32x32' },
      { url: '/icon-16.png?v=2', type: 'image/png', sizes: '16x16' },
    ],
    apple: '/apple-touch-icon.png?v=2',
  },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Collage 44' },
};

export const viewport: Viewport = { themeColor: '#0a0608' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
