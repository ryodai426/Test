import { createHash, randomBytes, randomInt } from 'node:crypto';
import { cookies } from 'next/headers';
import { one, q } from './db';

export const COOKIE = 'wt_session';
const MAX_AGE_DAYS = 180; // 使うたびに延長。会社PCで毎週ログインし直す手間をなくす

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export type User = { id: string; name: string; tz: string };

export async function createSession(userId: string, device: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  await q('INSERT INTO sessions (token_hash, user_id, device) VALUES ($1, $2, $3)', [hash(token), userId, device.slice(0, 120)]);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: MAX_AGE_DAYS * 86400,
  });
}

/** Cookie のログイン情報（ハッシュにしたもの）。なければ null */
export async function sessionTokenHash(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? hash(token) : null;
}

/** 1日1回だけ、ログインの期限を延ばす（書き込みを減らす） */
export async function touchSession(lastUsedAt: string | Date): Promise<void> {
  if (Date.now() - new Date(lastUsedAt).getTime() <= 86400000) return;
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return;
  await q('UPDATE sessions SET last_used_at = now() WHERE token_hash = $1', [hash(token)]);
  jar.set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: MAX_AGE_DAYS * 86400 });
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const row = await one<User & { last_used_at: Date }>(
    `SELECT u.id, u.name, u.tz, s.last_used_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.last_used_at > now() - interval '${MAX_AGE_DAYS} days'`,
    [hash(token)],
  );
  if (!row) return null;
  // 1日に1回だけ期限を延ばす（書き込みを減らす）
  if (Date.now() - new Date(row.last_used_at).getTime() > 86400000) {
    await q('UPDATE sessions SET last_used_at = now() WHERE token_hash = $1', [hash(token)]);
    jar.set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: MAX_AGE_DAYS * 86400 });
  }
  return { id: row.id, name: row.name, tz: row.tz };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [hash(token)]);
  jar.delete(COOKIE);
}

/** 別の端末を追加するための6桁コード */
export async function issueLinkCode(userId: string): Promise<string> {
  await q('DELETE FROM link_codes WHERE expires_at < now() OR user_id = $1', [userId]);
  for (let i = 0; i < 5; i++) {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const r = await q(
      `INSERT INTO link_codes (code, user_id, expires_at) VALUES ($1, $2, now() + interval '10 minutes')
       ON CONFLICT DO NOTHING RETURNING code`, [code, userId]);
    if (r.length) return code;
  }
  throw new Error('コードを発行できませんでした');
}

export async function consumeLinkCode(code: string): Promise<string | null> {
  const row = await one<{ user_id: string }>(
    'DELETE FROM link_codes WHERE code = $1 AND expires_at > now() RETURNING user_id', [code.replace(/\D/g, '')]);
  return row?.user_id ?? null;
}
