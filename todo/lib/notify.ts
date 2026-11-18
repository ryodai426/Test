import { q } from './db';
import { DRAFT_STEPS, nowIn, occursOn, addDays, reminderMessage, reminderTimes, zonedToUtc, weekday, type Repeat } from './time';

import { createECDH } from 'crypto';

/** 環境変数の値を整える（貼り付けたときに入りがちな空白・改行・引用符・「VAPID_PUBLIC_KEY=」を取り除く） */
function cleanKey(v: string | undefined): string {
  return (v || '').trim().replace(/^[A-Z_]+=/, '').replace(/^["']|["']$/g, '').replace(/\s+/g, '');
}
function b64urlBytes(s: string): Buffer | null {
  try { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); } catch { return null; }
}

export function vapid() {
  const publicKey = cleanKey(process.env.VAPID_PUBLIC_KEY).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const privateKey = cleanKey(process.env.VAPID_PRIVATE_KEY).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  // 送り元は mailto: か https:// の形でないと送れない。ドメインだけなら https:// を付ける
  let subject = (process.env.VAPID_SUBJECT || '').trim().replace(/^["']|["']$/g, '');
  if (!subject) subject = 'mailto:admin@example.com';
  else if (/^[^@\s]+@[^@\s]+$/.test(subject)) subject = 'mailto:' + subject;
  else if (!/^(mailto:|https:\/\/)/.test(subject)) subject = 'https://' + subject.replace(/^http:\/\//, '');
  return { publicKey, privateKey, subject };
}

/** 鍵に問題があれば、その説明（日本語）。問題なければ null */
export function vapidProblem(): string | null {
  const { publicKey, privateKey } = vapid();
  if (!publicKey || !privateKey) return '未設定：VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY を入れて Redeploy してください';
  const pub = b64urlBytes(publicKey);
  const priv = b64urlBytes(privateKey);
  if (!pub || pub.length !== 65 || pub[0] !== 4) {
    if (priv && priv.length === 65 && pub && pub.length === 32) return 'NG：VAPID_PUBLIC_KEY と VAPID_PRIVATE_KEY が逆に入っています。入れ替えて Redeploy してください';
    return `NG：VAPID_PUBLIC_KEY の形が違います（長さ ${publicKey.length} 文字。正しくは87文字）。鍵を作り直して入れ直してください`;
  }
  if (!priv || priv.length !== 32) return `NG：VAPID_PRIVATE_KEY の形が違います（長さ ${privateKey.length} 文字。正しくは43文字）`;
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(priv);
    if (!ecdh.getPublicKey().equals(pub)) return 'NG：VAPID_PUBLIC_KEY と VAPID_PRIVATE_KEY が組になっていません（別々に作った鍵）。同じときに作った2つを入れてください';
  } catch {
    return 'NG：VAPID_PRIVATE_KEY が正しくありません';
  }
  return null;
}

export const pushEnabled = () => vapidProblem() === null;

type Payload = { title: string; body: string; url?: string; tag?: string; confirm?: { taskId: string; day: string } };

/** その人の全端末（スマホ・PC）にプッシュ通知を送る */
export async function pushTo(userId: string, p: Payload, errors?: string[]): Promise<number> {
  if (!pushEnabled()) return 0;
  const subs = await q<{ endpoint: string; p256dh: string; auth: string }>(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
  if (!subs.length) return 0;
  const { sendNotification } = await import('web-push'); // 通知を送るときだけ読み込む
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try {
      await sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(p),
        {
          TTL: 600,
          vapidDetails: {
            ...vapid(),
          },
        },
      );
      sent++;
    } catch (e: any) {
      console.error('push failed', e?.statusCode, e?.body || e?.message);
      errors?.push(`${e?.statusCode || ''} ${String(e?.body || e?.message || e).slice(0, 160)}`.trim());
      // 端末側で通知をやめた・アプリを消した場合は登録を消す
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await q('DELETE FROM push_subscriptions WHERE endpoint = $1', [s.endpoint]);
      }
    }
  }));
  return sent;
}

/** 同じリマインドを二重に送らない。初めてなら true */
async function claim(key: string): Promise<boolean> {
  const r = await q('INSERT INTO sent_reminders (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [key]);
  return r.length > 0;
}

/**
 * 1分ごとに外部から呼ばれる想定。
 * 鳴らすべき時刻を過ぎて15分以内で、まだ送っていないリマインドを送る。
 */
export async function runDueReminders(now = Date.now()): Promise<{ sent: number }> {
  const windowStart = now - 15 * 60000;
  let sent = 0;

  // ① 時間が決まっているタスク（会議・当番など）
  const tasks = await q<{
    id: string; user_id: string; group_id: string; title: string; date: string; time: string;
    repeat: Repeat | null; reminders: string[]; remind_all: boolean; tz: string; done_at: string | null; assignees: string[] | null;
  }>(
    `SELECT t.id, t.user_id, t.group_id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.repeat, t.reminders,
            t.remind_all, u.tz, t.done_at, t.assignees
       FROM tasks t JOIN users u ON u.id = t.user_id
      WHERE t.status = 'ready' AND t.time IS NOT NULL AND cardinality(t.reminders) > 0
        AND (t.repeat IS NOT NULL OR t.date BETWEEN current_date - 2 AND current_date + 2)`);
  for (const t of tasks) {
    if (!t.repeat && t.done_at) continue;
    const today = nowIn(t.tz, new Date(now)).date;
    for (const day of [today, addDays(today, 1)]) {
      if (!occursOn(t, day)) continue;
      for (const r of reminderTimes(t, day, t.tz)) {
        if (r.at > now || r.at < windowStart) continue;
        if (!(await claim(`task:${t.id}:${day}:${r.key}`))) continue;
        const done = t.repeat ? await q('SELECT 1 FROM task_done WHERE task_id = $1 AND occ_date = $2', [t.id, day]) : [];
        if (done.length) continue;
        // 表示する人が決まっていればその人たちへ。共通なら、作った人（「全員に通知」なら全員）
        const recipients = t.assignees?.length
          ? t.assignees
          : t.remind_all
            ? (await q<{ user_id: string }>('SELECT user_id FROM memberships WHERE group_id = $1', [t.group_id])).map(m => m.user_id)
            : [t.user_id];
        const body = reminderMessage(t.title, r.key, t.time);
        for (const uid of recipients) {
          sent += await pushTo(uid, { title: '⏰ リマインド', body, url: `/?date=${day}`, tag: `task-${t.id}-${day}` });
        }
      }
    }
  }

  // ② 何も書かずに保存したメモだけ（2分→5分→10分）。ひとことでも書いてあれば、メモとして十分なので知らせない
  const drafts = await q<{ id: string; user_id: string; title: string; captured_at: Date }>(
    `SELECT id, user_id, title, captured_at FROM tasks
      WHERE status = 'draft' AND title = '' AND description = '' AND captured_at > now() - interval '30 minutes'`);
  for (const d of drafts) {
    for (const step of DRAFT_STEPS) {
      const at = new Date(d.captured_at).getTime() + step.min * 60000;
      if (at > now || at < windowStart) continue;
      if (!(await claim(`draft:${d.id}:${step.min}`))) continue;
      sent += await pushTo(d.user_id, { title: '📋 未記入のメモ', body: step.text(d.title), url: `/?edit=${d.id}`, tag: `draft-${d.id}` });
    }
  }

  // ②' メモがたまっていたら、お昼の12時に1回お知らせ
  const memoUsers = await q<{ id: string; tz: string; n: number }>(
    `SELECT u.id, u.tz, count(t.id)::int AS n FROM users u JOIN tasks t ON t.user_id = u.id AND t.status = 'draft' GROUP BY u.id`);
  for (const mu of memoUsers) {
    const { date } = nowIn(mu.tz, new Date(now));
    const at = zonedToUtc(date, '12:00', mu.tz);
    if (at > now || at < windowStart) continue;
    if (!(await claim(`memos:${mu.id}:${date}`))) continue;
    sent += await pushTo(mu.id, { title: '📋 メモがたまっています', body: `貼ったままのメモが${mu.n}枚あります。見ておきますか？`, url: '/?memos=1', tag: `memos-${date}` });
  }

  // ③' 夜20時に「今日の振り返り」（スキップにしていない人だけ）
  const reviewers = await q<{ id: string; tz: string }>('SELECT id, tz FROM users WHERE NOT review_skip');
  for (const r of reviewers) {
    const { date } = nowIn(r.tz, new Date(now));
    const at = zonedToUtc(date, '20:00', r.tz);
    if (at > now || at < windowStart) continue;
    if (!(await claim(`review:${r.id}:${date}`))) continue;
    sent += await pushTo(r.id, { title: '🌙 今日もおつかれさまでした', body: '今日の振り返りを見ますか？', url: '/?review=1', tag: `review-${date}` });
  }

  // ③ リスト（持ち物チェックなど。時間で表示）
  const lists = await q<{ id: string; user_id: string; name: string; show_at: string; weekdays: number[]; tz: string }>(
    `SELECT c.id, c.user_id, c.name, c.show_at, c.weekdays, u.tz FROM checklists c JOIN users u ON u.id = c.user_id
      WHERE c.trigger = 'time' AND c.show_at IS NOT NULL`);
  for (const c of lists) {
    const { date } = nowIn(c.tz, new Date(now));
    if (!c.weekdays.includes(weekday(date))) continue;
    const at = zonedToUtc(date, c.show_at, c.tz);
    if (at > now || at < windowStart) continue;
    if (!(await claim(`check:${c.id}:${date}`))) continue;
    sent += await pushTo(c.user_id, { title: '✅ リスト', body: `「${c.name}」を確認しましょう`, url: `/?checklist=${c.id}`, tag: `check-${c.id}` });
  }

  // ④ 終わる時間から30分たっても完了になっていない予定に「完了しましたか？」
  sent += await runDoneChecks(now, windowStart);

  await q("DELETE FROM sent_reminders WHERE sent_at < now() - interval '3 days'");
  await q("DELETE FROM auth_failures WHERE at < now() - interval '1 day'");
  return { sent };
}

/** 予定が終わる時間（分）。時刻のない予定は対象外 */
function endMin(time: string, duration: number) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m + Math.max(20, duration || 60);
}

/**
 * 「完了しましたか？」を聞く。終わる時間から30分たっても完了していない予定が対象。
 * 「まだ」なら15分後にもう一度、「保留」ならもう聞かない。返事がなければ、同じ質問は繰り返さない。
 * 聞く相手：表示する人／共通なら作った人／個人グループなら持ち主
 */
async function runDoneChecks(now: number, windowStart: number): Promise<number> {
  let sent = 0;
  const rows = await q<{
    id: string; user_id: string; title: string; date: string; time: string; duration_min: number; repeat: Repeat | null;
    done_at: string | null; assignees: string[] | null; tz: string;
  }>(
    `SELECT t.id, t.user_id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.duration_min, t.repeat, t.done_at, t.assignees, u.tz
       FROM tasks t JOIN users u ON u.id = t.user_id
      WHERE t.status = 'ready' AND t.time IS NOT NULL AND t.kind <> 'shopping'
        AND (t.repeat IS NOT NULL OR (t.date BETWEEN current_date - 1 AND current_date + 1 AND t.done_at IS NULL))`);
  for (const t of rows) {
    const day = nowIn(t.tz, new Date(now)).date;
    if (!occursOn(t, day)) continue;
    const em = endMin(t.time, t.duration_min);
    if (em >= 24 * 60) continue;
    const due = zonedToUtc(day, `${String(Math.floor(em / 60)).padStart(2, '0')}:${String(em % 60).padStart(2, '0')}`, t.tz) + 30 * 60000;
    if (due > now) continue;
    const [doneRow] = await q('SELECT 1 FROM task_done WHERE task_id = $1 AND occ_date = $2', [t.id, day]);
    if (t.repeat ? doneRow : t.done_at) continue;
    const [f] = await q<{ state: string; snooze_count: number; next_at: Date | null }>(
      'SELECT state, snooze_count, next_at FROM task_followups WHERE task_id = $1 AND occ_date = $2', [t.id, day]);
    if (f?.state === 'held') continue;
    let key: string;
    if (!f) {
      if (due < windowStart) continue; // 最初の質問は、その時刻を過ぎて間もないときだけ
      key = `confirm:${t.id}:${day}:0`;
    } else {
      const at = f.next_at ? new Date(f.next_at).getTime() : 0;
      if (!at || at > now || at < windowStart) continue;
      key = `confirm:${t.id}:${day}:${f.snooze_count}`;
    }
    if (!(await claim(key))) continue;
    const to = t.assignees?.length ? t.assignees : [t.user_id];
    for (const uid of to) {
      sent += await pushTo(uid, {
        title: '✅ 完了しましたか？', body: `「${t.title}」（${t.time}〜）`,
        url: `/?confirm=${t.id}&day=${day}`, tag: `confirm-${t.id}-${day}`, confirm: { taskId: t.id, day },
      });
    }
  }
  return sent;
}
