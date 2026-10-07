import type { Metadata, Viewport } from 'next';
import { Public_Sans, Gowun_Batang } from 'next/font/google';
import './globals.css';
import RegisterSW from './RegisterSW';

// Charte LFI 2027 : Public Sans remplace Config Variable (titres 900 en
// majuscules, interface 600-800), Gowun Batang remplace le corps de texte de la
// charte et ne sert qu'aux phrases descriptives courtes.
const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-sans',
  display: 'swap',
});
const gowun = Gowun_Batang({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Casse-Noisette — collage militant',
  description: 'Tournées de collage des militants insoumis — panneaux d’affichage libre, département par département',
  manifest: '/manifest.webmanifest?v=4',
  icons: {
    icon: [
      { url: '/favicon.ico?v=3', sizes: 'any' },
      { url: '/icon-32.png?v=3', type: 'image/png', sizes: '32x32' },
      { url: '/icon-16.png?v=3', type: 'image/png', sizes: '16x16' },
    ],
    apple: '/apple-touch-icon.png?v=3',
  },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Collage' },
};

// viewport-fit=cover : installée (standalone, barre d'état « black-translucent »
// sur iOS), l'appli occupe tout l'écran, encoche comprise ; chaque bandeau
// se décale de env(safe-area-inset-*) (globals.css).
export const viewport: Viewport = { themeColor: '#4C0297', viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${publicSans.variable} ${gowun.variable}`}>
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
