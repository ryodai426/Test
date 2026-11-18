import { q } from './db';
import { DRAFT_STEPS, nowIn, occursOn, addDays, reminderMessage, reminderTimes, zonedToUtc, weekday, type Repeat } from './time';

export const pushEnabled = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

type Payload = { title: string; body: string; url?: string; tag?: string };

/** その人の全端末（スマホ・PC）にプッシュ通知を送る */
export async function pushTo(userId: string, p: Payload): Promise<number> {
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
            subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
            publicKey: process.env.VAPID_PUBLIC_KEY!,
            privateKey: process.env.VAPID_PRIVATE_KEY!,
          },
        },
      );
      sent++;
    } catch (e: any) {
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

  // ② 未記入メモ（2分→5分→10分）
  const drafts = await q<{ id: string; user_id: string; title: string; captured_at: Date }>(
    `SELECT id, user_id, title, captured_at FROM tasks
      WHERE status = 'draft' AND captured_at > now() - interval '30 minutes'`);
  for (const d of drafts) {
    for (const step of DRAFT_STEPS) {
      const at = new Date(d.captured_at).getTime() + step.min * 60000;
      if (at > now || at < windowStart) continue;
      if (!(await claim(`draft:${d.id}:${step.min}`))) continue;
      sent += await pushTo(d.user_id, { title: '📋 未記入のメモ', body: step.text(d.title), url: `/?edit=${d.id}`, tag: `draft-${d.id}` });
    }
  }

  // ③ 持ち物チェックリスト（時間で表示）
  const lists = await q<{ id: string; user_id: string; name: string; show_at: string; weekdays: number[]; tz: string }>(
    `SELECT c.id, c.user_id, c.name, c.show_at, c.weekdays, u.tz FROM checklists c JOIN users u ON u.id = c.user_id
      WHERE c.trigger = 'time' AND c.show_at IS NOT NULL`);
  for (const c of lists) {
    const { date } = nowIn(c.tz, new Date(now));
    if (!c.weekdays.includes(weekday(date))) continue;
    const at = zonedToUtc(date, c.show_at, c.tz);
    if (at > now || at < windowStart) continue;
    if (!(await claim(`check:${c.id}:${date}`))) continue;
    sent += await pushTo(c.user_id, { title: '✅ 持ち物チェック', body: `「${c.name}」を確認しましょう`, url: `/?checklist=${c.id}`, tag: `check-${c.id}` });
  }

  await q("DELETE FROM sent_reminders WHERE sent_at < now() - interval '3 days'");
  await q("DELETE FROM auth_failures WHERE at < now() - interval '1 day'");
  return { sent };
}
