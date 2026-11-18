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
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
