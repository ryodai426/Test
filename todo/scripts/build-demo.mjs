// サーバーなしで動く1ファイルのデモ（demo/dist/index.html）を作る
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const r = await build({
  entryPoints: ['demo/entry.tsx'],
  bundle: true, minify: true, write: false, format: 'iife', target: 'es2020',
  jsx: 'automatic', alias: { '@': '.' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('app/globals.css', 'utf8');
const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>わすれないTODO</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
mkdirSync('demo/dist', { recursive: true });
writeFileSync('demo/dist/index.html', html);
console.log(`demo/dist/index.html (${Math.round(html.length / 1024)} KB)`);
