import { q } from './db';
import { getNextAt, setNextAt } from './kv';
import { DRAFT_STEPS, titleOr, nowIn, occursOn, addDays, reminderMessage, reminderTimes, zonedToUtc, weekday, type Repeat } from './time';

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
 * 通知は「数分おき」にまとめて送る（今は10分おきの呼び出しを想定。リアルタイムである必要はない）。
 * 呼び出しが遅れたり1回抜けたりしても送れるように、鳴らす時刻を過ぎて WINDOW 以内なら送る。
 */
export const WINDOW = 30 * 60000;
/** 次の時刻を計算するとき、どこまで先を見るか。これより先に何もなくても、この時刻にはデータベースを見直す */
const LOOKAHEAD = 6 * 3600000;

/** これから鳴らす通知1件。at に鳴らし、送る直前にもう一度状態を確かめる（fire の中） */
type Due = { at: number; key: string; fire: () => Promise<number> };

/** 予定の時刻の「HH:MM」に分を足す（日をまたいだら null） */
function addMinutes(time: string, add: number): string | null {
  const [h, m] = time.split(':').map(Number);
  const t = h * 60 + m + add;
  if (t >= 24 * 60) return null;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** now の前後で鳴らす可能性のある通知を、すべて集める */
async function collect(now: number): Promise<Due[]> {
  const out: Due[] = [];
  const from = now - WINDOW;
  const to = now + LOOKAHEAD;
  const near = (at: number) => at >= from && at <= to;

  // ① 時間が決まっている予定のリマインド（会議・当番など）
  const tasks = await q<{
    id: string; user_id: string; group_id: string; title: string; date: string; time: string; duration_min: number; kind: string;
    repeat: Repeat | null; reminders: string[]; remind_all: boolean; tz: string; done_at: string | null; assignees: string[] | null;
  }>(
    `SELECT t.id, t.user_id, t.group_id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.duration_min, t.kind,
            t.repeat, t.reminders, t.remind_all, u.tz, t.done_at, t.assignees
       FROM tasks t JOIN users u ON u.id = t.user_id
      WHERE t.status = 'ready' AND t.time IS NOT NULL AND t.done_at IS NULL
        AND (t.repeat IS NOT NULL OR t.date BETWEEN current_date - 2 AND current_date + 2)`);
  for (const t of tasks) t.title = titleOr(t); // タイトルが空なら種類の名前
  const isDone = async (t: { id: string; repeat: Repeat | null }, day: string) =>
    !!t.repeat && (await q('SELECT 1 FROM task_done WHERE task_id = $1 AND occ_date = $2', [t.id, day])).length > 0;

  for (const t of tasks) {
    const today = nowIn(t.tz, new Date(now)).date;
    for (const day of [addDays(today, -1), today, addDays(today, 1)]) {
      if (!occursOn(t, day)) continue;
      for (const r of reminderTimes(t, day, t.tz)) {
        if (!near(r.at)) continue;
        out.push({
          at: r.at, key: `task:${t.id}:${day}:${r.key}`,
          fire: async () => {
            if (await isDone(t, day)) return 0;
            // 表示する人が決まっていればその人たちへ。共通なら、作った人（「全員に通知」なら全員）
            const to = t.assignees?.length ? t.assignees
              : t.remind_all ? (await q<{ user_id: string }>('SELECT user_id FROM memberships WHERE group_id = $1', [t.group_id])).map(m => m.user_id)
              : [t.user_id];
            let n = 0;
            for (const uid of to) n += await pushTo(uid, { title: '⏰ リマインド', body: reminderMessage(t.title, r.key, t.time), url: `/?date=${day}`, tag: `task-${t.id}-${day}` });
            return n;
          },
        });
      }
    }
  }

  // ② 終わる時間から30分たっても完了になっていない予定に「完了しましたか？」
  //    聞く相手：表示する人／共通なら作った人。「まだ」なら15分後にもう一度、「保留」ならもう聞かない
  const followups = await q<{ task_id: string; occ_date: string; state: string; snooze_count: number; next_at: Date | null }>(
    `SELECT task_id, to_char(occ_date, 'YYYY-MM-DD') AS occ_date, state, snooze_count, next_at FROM task_followups WHERE occ_date >= current_date - 1`);
  const fmap = new Map(followups.map(f => [f.task_id + '|' + f.occ_date, f]));
  for (const t of tasks) {
    if (t.kind === 'shopping') continue;
    const today = nowIn(t.tz, new Date(now)).date;
    for (const day of [addDays(today, -1), today]) {
      if (!occursOn(t, day)) continue;
      const end = addMinutes(t.time, Math.max(20, t.duration_min || 60));
      if (!end) continue; // 日をまたぐ予定は対象外
      const f = fmap.get(t.id + '|' + day);
      if (f?.state === 'held') continue;
      const first = zonedToUtc(day, end, t.tz) + 30 * 60000;
      const at = f ? (f.next_at ? new Date(f.next_at).getTime() : 0) : first;
      if (!at || !near(at)) continue;
      out.push({
        at, key: `confirm:${t.id}:${day}:${f?.snooze_count || 0}`,
        fire: async () => {
          if (await isDone(t, day)) return 0;
          let n = 0;
          for (const uid of t.assignees?.length ? t.assignees : [t.user_id]) {
            n += await pushTo(uid, {
              title: '✅ 完了しましたか？', body: `「${t.title}」（${t.time}〜）`,
              url: `/?confirm=${t.id}&day=${day}`, tag: `confirm-${t.id}-${day}`, confirm: { taskId: t.id, day },
            });
          }
          return n;
        },
      });
    }
  }

  // ③ 何も書かずに保存したメモ（2分→5分→10分）。数分おきの送信なので、まとめて届いたときは一番新しい1通だけ送る
  const drafts = await q<{ id: string; user_id: string; title: string; captured_at: Date }>(
    `SELECT id, user_id, title, captured_at FROM tasks
      WHERE status = 'draft' AND title = '' AND description = '' AND captured_at > now() - interval '45 minutes'`);
  for (const d of drafts) {
    DRAFT_STEPS.forEach((step, i) => {
      const at = new Date(d.captured_at).getTime() + step.min * 60000;
      if (!near(at)) return;
      out.push({
        at, key: `draft:${d.id}:${step.min}`,
        fire: async () => {
          const later = DRAFT_STEPS[i + 1];
          if (later && new Date(d.captured_at).getTime() + later.min * 60000 <= now) return 0; // もっと新しい1通を送る
          return pushTo(d.user_id, { title: '📋 未記入のメモ', body: step.text(d.title), url: `/?edit=${d.id}`, tag: `draft-${d.id}` });
        },
      });
    });
  }

  // ④ 毎日決まった時刻：12時にたまったメモ、20時に今日の振り返り
  const users = await q<{ id: string; tz: string; review_skip: boolean; drafts: number }>(
    `SELECT u.id, u.tz, u.review_skip, (SELECT count(*)::int FROM tasks t WHERE t.user_id = u.id AND t.status = 'draft') AS drafts FROM users u`);
  for (const u of users) {
    const today = nowIn(u.tz, new Date(now)).date;
    for (const day of [today, addDays(today, 1)]) {
      const noon = zonedToUtc(day, '12:00', u.tz);
      if (u.drafts && near(noon)) {
        out.push({ at: noon, key: `memos:${u.id}:${day}`, fire: () => pushTo(u.id, { title: '📋 メモがたまっています', body: `貼ったままのメモが${u.drafts}枚あります。見ておきますか？`, url: '/?memos=1', tag: `memos-${day}` }) });
      }
      const eve = zonedToUtc(day, '20:00', u.tz);
      if (!u.review_skip && near(eve)) {
        out.push({ at: eve, key: `review:${u.id}:${day}`, fire: () => pushTo(u.id, { title: '🌙 今日もおつかれさまでした', body: '今日の振り返りを見ますか？', url: '/?review=1', tag: `review-${day}` }) });
      }
    }
  }

  // ⑤ リスト（持ち物チェックなど。決まった時間に表示）
  const lists = await q<{ id: string; user_id: string; name: string; show_at: string; weekdays: number[]; tz: string }>(
    `SELECT c.id, c.user_id, c.name, c.show_at, c.weekdays, u.tz FROM checklists c JOIN users u ON u.id = c.user_id
      WHERE c.trigger = 'time' AND c.show_at IS NOT NULL`);
  for (const c of lists) {
    const today = nowIn(c.tz, new Date(now)).date;
    for (const day of [today, addDays(today, 1)]) {
      if (!c.weekdays.includes(weekday(day))) continue;
      const at = zonedToUtc(day, c.show_at, c.tz);
      if (!near(at)) continue;
      out.push({ at, key: `check:${c.id}:${day}`, fire: () => pushTo(c.user_id, { title: '✅ リスト', body: `「${c.name}」を確認しましょう`, url: `/?checklist=${c.id}`, tag: `check-${c.id}` }) });
    }
  }
  return out;
}

/**
 * 通知の呼び出し（/api/cron、数分おき）の本体。
 * 時刻が来た通知を送り、次に送る時刻を返す。force でなければ、時刻が来るまでデータベースに触らない（lib/kv.ts）。
 */
export async function runDueReminders(now = Date.now(), force = false): Promise<{ sent: number; checked: boolean; nextAt: string | null }> {
  if (!force) {
    const next = await getNextAt();
    if (next && next > now) return { sent: 0, checked: false, nextAt: new Date(next).toISOString() };
  }
  const due = await collect(now);
  let sent = 0;
  for (const d of due.sort((a, b) => a.at - b.at)) {
    if (d.at > now) continue;
    if (!(await claim(d.key))) continue;
    sent += await d.fire();
  }
  // 次に送る時刻（何もなければ LOOKAHEAD 後に見直す）
  const future = due.filter(d => d.at > now).map(d => d.at);
  const nextAt = Math.min(now + LOOKAHEAD, ...future);
  await setNextAt(nextAt);

  await q("DELETE FROM sent_reminders WHERE sent_at < now() - interval '3 days'");
  await q("DELETE FROM auth_failures WHERE at < now() - interval '1 day'");
  return { sent, checked: true, nextAt: new Date(nextAt).toISOString() };
}
