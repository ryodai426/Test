import { Pool, type PoolClient } from 'pg';
import { SCHEMA_SQL } from './schema';

declare global {
  // 開発中のホットリロードで接続が増えないように使い回す
  var __pgPool: Pool | undefined;
  var __pgReady: Promise<void> | undefined;
}

/**
 * データベースの接続先。Vercel の Neon 連携は DATABASE_URL のほか POSTGRES_URL や
 * 「接頭辞_DATABASE_URL」の名前で入れることがあるので、それも探す。
 */
export function databaseUrl(): { name: string; url: string } | null {
  const env = process.env;
  for (const name of ['DATABASE_URL', 'POSTGRES_URL']) if (env[name]) return { name, url: env[name]! };
  const name = Object.keys(env).find(k => /(_DATABASE_URL|_POSTGRES_URL)$/.test(k) && !/UNPOOLED|NON_POOLING/.test(k) && env[k]);
  return name ? { name, url: env[name]! } : null;
}

function makePool() {
  const found = databaseUrl();
  if (!found) throw new Error('DATABASE_URL が設定されていません（Vercel の Storage で Neon を追加し、Redeploy してください）');
  const local = /localhost|127\.0\.0\.1/.test(found.url);
  // URL に sslmode が書いてあればそれに従う。なければ、ローカル以外は暗号化して接続
  const ssl = local ? false : /sslmode=/.test(found.url) ? undefined : { rejectUnauthorized: false };
  return new Pool({ connectionString: found.url, ssl, max: 5, connectionTimeoutMillis: 10000 });
}

export function pool(): Pool {
  if (!globalThis.__pgPool) globalThis.__pgPool = makePool();
  return globalThis.__pgPool;
}

/**
 * 初めて使うときに、表（テーブル）を自動で作る。
 * スキーマ（lib/schema.ts）は何度実行しても安全なので、デプロイ後に手作業で SQL を流す必要はない。
 */
// スキーマの版。lib/schema.ts を変えたら自動で変わる
const SCHEMA_VERSION = (() => {
  let h = 0;
  for (let i = 0; i < SCHEMA_SQL.length; i++) h = (h * 31 + SCHEMA_SQL.charCodeAt(i)) | 0;
  return String(h >>> 0);
})();

export function ready(): Promise<void> {
  if (!globalThis.__pgReady) {
    globalThis.__pgReady = (async () => {
      // すでに最新なら、確認の1往復だけで終わる（毎回すべての表を確かめない）
      try {
        const r = await pool().query("SELECT value FROM app_meta WHERE key = 'schema'");
        if (r.rows[0]?.value === SCHEMA_VERSION) return;
      } catch { /* まだ表がない＝はじめて */ }
      const c = await pool().connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(8124301)'); // 同時に複数のサーバーが作ろうとしても1つずつ
        await c.query(SCHEMA_SQL);
        await c.query(`INSERT INTO app_meta (key, value) VALUES ('schema', $1)
                       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [SCHEMA_VERSION]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        globalThis.__pgReady = undefined; // 次の呼び出しでやり直す
        throw e;
      } finally {
        c.release();
      }
    })();
  }
  return globalThis.__pgReady;
}

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  const r = await pool().query(text, params);
  return r.rows as T[];
}

export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ready();
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
