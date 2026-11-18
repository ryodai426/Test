/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  serverExternalPackages: ['pg', 'web-push'],
  // 初回に表を自動で作るため、schema.sql をサーバーに含める
  outputFileTracingIncludes: { '/api/[...path]': ['./lib/schema.sql'] },
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] }];
  },
};
