import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'わすれないTODO',
  description: '忘れる前に気づかせる、共同タスク管理アプリ',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'わすれない', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
  robots: { index: false, follow: false }, // URLを知っている人だけが使う前提なので検索に出さない
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F4EFE3',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@500;600;700;800;900&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
