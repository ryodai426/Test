/** @type {import('next').NextConfig} */
// 公開ごとの版の印。画面とサーバーで同じ値になるので、食い違えば画面が古い（新しい版を読み込み直す）
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || String(Date.now());

export default {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD: BUILD },
  serverExternalPackages: ['pg', 'web-push'],
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] }];
  },
};
