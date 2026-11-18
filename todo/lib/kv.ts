/**
 * 「次に通知を送る時刻」を置いておく小さな保存場所（Upstash Redis の REST API。部品の追加は不要）。
 * 毎回データベースに問い合わせると Neon が眠れず、無料枠（月100 CU時間）を超えてしまうため、
 * 通知の呼び出し（/api/cron）はまずここを見て、時刻が来ていなければデータベースに触らずに終わる。
 * 設定がなければ何もしない（そのときは毎回データベースを見る）。
 */

function kvConfig(): { url: string; token: string; name: string } | null {
  const env = process.env;
  // Vercel の Storage から Upstash を追加すると、KV_REST_API_URL か UPSTASH_REDIS_REST_URL（接頭辞つきのことも）で入る
  const urlKey = ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'].find(k => env[k])
    || Object.keys(env).find(k => /(KV_REST_API_URL|REDIS_REST_URL)$/.test(k) && env[k]);
  if (!urlKey) return null;
  const tokenKey = urlKey.replace(/URL$/, 'TOKEN');
  const token = env[tokenKey];
  if (!token) return null;
  return { url: env[urlKey]!.replace(/\/$/, ''), token, name: urlKey };
}

export const kvName = () => kvConfig()?.name || null;

async function call(path: string): Promise<unknown> {
  const c = kvConfig();
  if (!c) return null;
  const res = await fetch(`${c.url}/${path}`, { headers: { Authorization: `Bearer ${c.token}` }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Redis ${res.status}`);
  return ((await res.json()) as { result: unknown }).result;
}

const KEY = 'next-notify-at';

/** 次に通知を送る時刻（UTC ms）。わからなければ null（＝データベースを見る） */
export async function getNextAt(): Promise<number | null> {
  try {
    const v = await call(`get/${KEY}`);
    return v == null ? null : Number(v) || null;
  } catch { return null; }
}

export async function setNextAt(at: number): Promise<void> {
  // 念のため1日で消える（消えたら、次の呼び出しでデータベースを見て計算し直す）
  try { await call(`set/${KEY}/${Math.floor(at)}/EX/86400`); } catch { /* なくても動く */ }
}

/** 予定やメモを書き換えたら、次の時刻を計算し直させる */
export async function clearNextAt(): Promise<void> {
  try { await call(`del/${KEY}`); } catch { /* なくても動く */ }
}
