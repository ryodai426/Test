import type { Metadata, Viewport } from 'next';
import { Noto_Sans_JP } from 'next/font/google';
import './globals.css';

// フォントはアプリと同じ場所から配る（別のサーバーへの接続と、表示の待ちをなくす）
const noto = Noto_Sans_JP({ weight: ['600', '700'], subsets: ['latin'], display: 'swap', variable: '--font-noto' });

export const metadata: Metadata = {
  title: 'わすれないYO',
  description: '忘れる前に気づかせる、共同タスク管理アプリ',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'わすれないYO', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
  robots: { index: false, follow: false }, // URLを知っている人だけが使う前提なので検索に出さない
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F5F1E4',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={noto.variable}>
      <body>{children}</body>
    </html>
  );
}
