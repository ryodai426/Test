import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';

declare global {
  // 開発中のホットリロードで接続が増えないように使い回す
  var __pgPool: Pool | undefined;
  var __pgReady: Promise<void> | undefined;
}

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL が設定されていません');
  const local = /localhost|127\.0\.0\.1/.test(url);
  return new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
}

export function pool(): Pool {
  if (!globalThis.__pgPool) globalThis.__pgPool = makePool();
  return globalThis.__pgPool;
}

/**
 * 初めて使うときに、表（テーブル）を自動で作る。
 * schema.sql は何度実行しても安全なので、デプロイ後に手作業で SQL を流す必要はない。
 */
function ready(): Promise<void> {
  if (!globalThis.__pgReady) {
    globalThis.__pgReady = (async () => {
      const sql = readFileSync(join(process.cwd(), 'lib', 'schema.sql'), 'utf8');
      const c = await pool().connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(8124301)'); // 同時に複数のサーバーが作ろうとしても1つずつ
        await c.query(sql);
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
