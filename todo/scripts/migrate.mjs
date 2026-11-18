// 手でスキーマを適用したいとき用（通常はアプリが初回に自動で作るので不要）
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL が未設定です'); process.exit(1); }
const src = readFileSync(new URL('../lib/schema.ts', import.meta.url), 'utf8');
const sql = src.slice(src.indexOf('`') + 1, src.lastIndexOf('`'));
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await client.connect();
await client.query(sql);
await client.end();
console.log('スキーマを適用しました');
