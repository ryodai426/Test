import { NextRequest, NextResponse } from 'next/server';
import { q, one, tx } from '@/lib/db';
import { consumeLinkCode, createSession, currentUser, destroySession, issueLinkCode, type User } from '@/lib/auth';
import { pushEnabled, pushTo, runDueReminders } from '@/lib/notify';
import { KIND_PRESETS, nowIn } from '@/lib/time';

export const dynamic = 'force-dynamic';

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const bad = (m: string) => new HttpError(400, m);
const forbidden = () => new HttpError(403, '権限がありません');
const notFound = () => new HttpError(404, '見つかりません');

const COLORS = /^#[0-9a-fA-F]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS = Object.keys(KIND_PRESETS);
const REMINDERS = ['eve', '60', '30', '10', '5', '0'];
const EMOJIS = ['👍', '❤️', '💪', '👏'];

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function deviceName(req: NextRequest) {
  const ua = req.headers.get('user-agent') || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'ブラウザ';
}

async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, 'ログインしてください');
  return u;
}

async function requireMember(userId: string, groupId: string) {
  const g = await one('SELECT g.* FROM groups g JOIN memberships m ON m.group_id = g.id WHERE g.id = $1 AND m.user_id = $2', [groupId, userId]);
  if (!g) throw forbidden();
  return g;
}

/** 見られるタスクだけ取り出す（未記入メモは本人だけ） */
async function requireTask(userId: string, taskId: string) {
  const t = await one(
    `SELECT t.*, g.is_personal, g.notify_create, g.notify_done, g.name AS group_name FROM tasks t
       JOIN groups g ON g.id = t.group_id JOIN memberships m ON m.group_id = t.group_id AND m.user_id = $1
      WHERE t.id = $2`, [userId, taskId]);
  if (!t || (t.status === 'draft' && t.user_id !== userId)) throw notFound();
  return t;
}

/** 同じグループの他のメンバーに、付箋のお知らせを入れる */
async function notifyMembers(groupId: string, actorId: string, kind: string, taskId: string, body: string, occDate: string | null = null) {
  await q(
    `INSERT INTO notifications (user_id, kind, actor_id, task_id, occ_date, body)
     SELECT m.user_id, $3, $2, $4, $5, $6 FROM memberships m WHERE m.group_id = $1 AND m.user_id <> $2`,
    [groupId, actorId, kind, taskId, occDate, body]);
}

async function personalGroupId(userId: string): Promise<string> {
  const g = await one<{ id: string }>('SELECT id FROM groups WHERE owner_id = $1 AND is_personal LIMIT 1', [userId]);
  if (!g) throw new HttpError(500, '個人グループがありません');
  return g.id;
}

function cleanTask(b: any, partial: boolean) {
  const out: Record<string, unknown> = {};
  const has = (k: string) => !partial || k in b;
  if (has('title')) out.title = str(b.title, 120);
  if (has('description')) out.description = str(b.description, 2000);
  if (has('kind')) out.kind = KINDS.includes(b.kind) ? b.kind : 'general';
  if (has('color')) out.color = b.color && COLORS.test(b.color) ? b.color : null;
  if (has('date')) out.date = b.date && DATE.test(b.date) ? b.date : null;
  if (has('time')) out.time = b.time && TIME.test(b.time) ? b.time : null;
  if (has('duration_min')) out.duration_min = Math.min(24 * 60, Math.max(5, Number(b.duration_min) || 60));
  if (has('reminders')) out.reminders = Array.isArray(b.reminders) ? [...new Set(b.reminders.map(String))].filter(r => REMINDERS.includes(r as string)) : [];
  if (has('remind_all')) out.remind_all = !!b.remind_all;
  if (has('repeat')) {
    const r = b.repeat;
    if (r && ['daily', 'weekly', 'monthly'].includes(r.freq)) {
      out.repeat = JSON.stringify({
        freq: r.freq,
        interval: Math.min(12, Math.max(1, Number(r.interval) || 1)),
        weekdays: Array.isArray(r.weekdays) ? r.weekdays.map(Number).filter((n: number) => n >= 0 && n <= 6) : [],
        monthMode: r.monthMode === 'nth' ? 'nth' : 'day',
        until: r.until && DATE.test(r.until) ? r.until : null,
      });
    } else out.repeat = null;
  }
  return out;
}

// ---------------------------------------------------------------- ルーティング

type Handler = (ctx: { req: NextRequest; body: any; params: string[]; url: URL }) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, pattern: string, h: Handler) =>
  routes.push([method, new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$'), h]);

// ---- ログイン -------------------------------------------------------------

route('POST', 'auth/register', async ({ req, body }) => {
  const name = str(body.name, 30);
  if (!name) throw bad('ユーザー名を入力してください');
  const tz = str(body.tz, 60) || 'Asia/Tokyo';
  const exists = await one('SELECT 1 FROM users WHERE lower(name) = lower($1)', [name]);
  if (exists) {
    throw new HttpError(409, 'この名前はすでに使われています。自分の名前なら、使っている端末の「⚙ 設定 → この端末以外でも使う」で6桁のコードを出して、「コードでログイン」から入ってください。');
  }
  const user = await tx(async c => {
    const u = (await c.query('INSERT INTO users (name, tz) VALUES ($1, $2) RETURNING id', [name, tz])).rows[0];
    const g = (await c.query(
      `INSERT INTO groups (name, color, is_personal, owner_id, notify_create, notify_done)
       VALUES ('個人（自分専用）', '#F5E211', true, $1, false, false) RETURNING id`, [u.id])).rows[0];
    await c.query('INSERT INTO memberships (group_id, user_id) VALUES ($1, $2)', [g.id, u.id]);
    // よく使う持ち物チェックリストを最初から用意しておく（テンプレート）
    const seeds: [string, string, string | null, string[]][] = [
      ['家を出る時', 'time', '07:00', ['財布', 'スマホ', '鍵', '社員証', '傘（天気を確認）', 'ゴミ']],
      ['お店を出る時', 'after_shopping', null, ['傘', '買った物', 'レシート']],
    ];
    for (const [i, [n, trig, at, items]] of seeds.entries()) {
      const cl = (await c.query('INSERT INTO checklists (user_id, name, trigger, show_at, position) VALUES ($1,$2,$3,$4,$5) RETURNING id', [u.id, n, trig, at, i])).rows[0];
      for (const [p, label] of items.entries()) await c.query('INSERT INTO checklist_items (checklist_id, label, position) VALUES ($1,$2,$3)', [cl.id, label, p]);
    }
    return u;
  });
  await createSession(user.id, deviceName(req));
  return { ok: true };
});

route('POST', 'auth/link', async ({ req, body }) => {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const fails = await one<{ n: number }>("SELECT count(*)::int AS n FROM auth_failures WHERE ip = $1 AND at > now() - interval '10 minutes'", [ip]);
  if ((fails?.n ?? 0) >= 10) throw new HttpError(429, '失敗が続いたので、10分ほど待ってからもう一度お試しください');
  const userId = await consumeLinkCode(str(body.code, 20));
  if (!userId) {
    await q('INSERT INTO auth_failures (ip) VALUES ($1)', [ip]);
    throw bad('コードが違うか、期限（10分）が切れています');
  }
  await createSession(userId, deviceName(req));
  return { ok: true };
});

route('POST', 'auth/link-code', async () => {
  const u = await requireUser();
  return { code: await issueLinkCode(u.id), expiresInSec: 600 };
});

route('POST', 'auth/logout', async () => {
  await destroySession();
  return { ok: true };
});

route('GET', 'devices', async () => {
  const u = await requireUser();
  return q("SELECT device, created_at, last_used_at FROM sessions WHERE user_id = $1 ORDER BY last_used_at DESC", [u.id]);
});

route('PATCH', 'me', async ({ body }) => {
  const u = await requireUser();
  const tz = str(body.tz, 60);
  if (tz) {
    try { new Intl.DateTimeFormat('ja', { timeZone: tz }); } catch { throw bad('タイムゾーンが不正です'); }
    await q('UPDATE users SET tz = $1 WHERE id = $2', [tz, u.id]);
  }
  return { ok: true };
});

// ---- 全データ（画面の表示用） -----------------------------------------------

route('GET', 'state', async ({ url }) => {
  const u = await currentUser();
  if (!u) return { me: null };
  const day = DATE.test(url.searchParams.get('day') || '') ? url.searchParams.get('day') : null;

  const groups = await q(
    `SELECT g.id, g.name, g.description, g.color, g.is_personal, g.owner_id, g.notify_create, g.notify_done,
            CASE WHEN g.is_personal THEN null ELSE g.invite_token END AS invite_token,
            COALESCE(json_agg(json_build_object('id', mu.id, 'name', mu.name) ORDER BY m2.joined_at) FILTER (WHERE mu.id IS NOT NULL), '[]') AS members
       FROM groups g
       JOIN memberships m ON m.group_id = g.id AND m.user_id = $1
       LEFT JOIN memberships m2 ON m2.group_id = g.id
       LEFT JOIN users mu ON mu.id = m2.user_id
      GROUP BY g.id ORDER BY g.is_personal DESC, g.created_at`, [u.id]);

  const tasks = await q(
    `SELECT t.id, t.user_id, t.group_id, t.status, t.title, t.description, t.kind, t.color,
            to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.duration_min, t.reminders, t.remind_all, t.repeat,
            t.captured_at, t.detailed_at, t.done_at, t.done_by, t.updated_at
       FROM tasks t JOIN memberships m ON m.group_id = t.group_id AND m.user_id = $1
      WHERE (t.status = 'ready' OR t.user_id = $1)
        AND (t.repeat IS NOT NULL OR t.date IS NULL OR t.date >= current_date - 70 OR t.done_at IS NULL)
      ORDER BY t.date NULLS LAST, t.time NULLS FIRST, t.created_at`, [u.id]);
  const ids = tasks.map(t => t.id);

  const [done, items, reactions] = ids.length ? await Promise.all([
    q("SELECT task_id, to_char(occ_date, 'YYYY-MM-DD') AS occ_date, user_id FROM task_done WHERE task_id = ANY($1) AND occ_date >= current_date - 70", [ids]),
    q('SELECT id, task_id, label, checked, position FROM task_items WHERE task_id = ANY($1) ORDER BY position, label', [ids]),
    q("SELECT task_id, to_char(occ_date, 'YYYY-MM-DD') AS occ_date, user_id, emoji FROM reactions WHERE task_id = ANY($1) AND occ_date >= current_date - 70", [ids]),
  ]) : [[], [], []];

  const checklists = await q(
    `SELECT c.id, c.name, c.trigger, c.show_at, c.weekdays, c.position,
            COALESCE(json_agg(json_build_object('id', i.id, 'label', i.label, 'checked', cc.item_id IS NOT NULL) ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM checklists c
       LEFT JOIN checklist_items i ON i.checklist_id = c.id
       LEFT JOIN checklist_checks cc ON cc.item_id = i.id AND cc.day = COALESCE($2::date, current_date)
      WHERE c.user_id = $1 GROUP BY c.id ORDER BY c.position, c.created_at`, [u.id, day]);

  const notifications = await q(
    `SELECT n.id, n.kind, n.task_id, to_char(n.occ_date, 'YYYY-MM-DD') AS occ_date, n.body, n.created_at, n.read_at, a.name AS actor
       FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
      WHERE n.user_id = $1 ORDER BY n.id DESC LIMIT 40`, [u.id]);

  return {
    me: u, groups, tasks, done, items, reactions, checklists, notifications,
    pushKey: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null,
  };
});

// ---- タスク ---------------------------------------------------------------

route('POST', 'tasks', async ({ body }) => {
  const u = await requireUser();
  // ワンボタンメモ：ひとことだけ（空でもOK）で、自分専用の未記入メモにする
  if (body.quick) {
    const t = await one('INSERT INTO tasks (user_id, group_id, status, title, reminders) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [u.id, await personalGroupId(u.id), 'draft', str(body.title, 120), '{}']);
    return t;
  }
  const groupId = body.group_id ? String(body.group_id) : await personalGroupId(u.id);
  const g = await requireMember(u.id, groupId);
  const f = cleanTask(body, false);
  if (!f.title) throw bad('タイトルを入力してください');
  const t = await one<{ id: string }>(
    `INSERT INTO tasks (user_id, group_id, status, title, description, kind, color, date, time, duration_min, reminders, remind_all, repeat, detailed_at)
     VALUES ($1,$2,'ready',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now()) RETURNING id`,
    [u.id, groupId, f.title, f.description, f.kind, f.color, f.date, f.time, f.duration_min, f.reminders, f.remind_all, f.repeat]);
  if (Array.isArray(body.items)) {
    for (const [i, label] of body.items.map((s: unknown) => str(s, 80)).filter(Boolean).entries()) {
      await q('INSERT INTO task_items (task_id, label, position) VALUES ($1,$2,$3)', [t!.id, label, i]);
    }
  }
  if (!g.is_personal && g.notify_create) await notifyMembers(groupId, u.id, 'created', t!.id, `${u.name}さんが「${f.title}」を設定しました`);
  return t;
});

route('PATCH', 'tasks/:id', async ({ body, params }) => {
  const u = await requireUser();
  const t = await requireTask(u.id, params[0]);
  const f = cleanTask(body, true);
  let groupId = t.group_id;
  if (body.group_id && body.group_id !== t.group_id) {
    await requireMember(u.id, body.group_id);
    groupId = body.group_id;
    f.group_id = groupId;
  }
  const becomingReady = t.status === 'draft' && body.status === 'ready';
  if (becomingReady) {
    if (!(f.title ?? t.title)) throw bad('タイトルを入力してください');
    f.status = 'ready';
    f.detailed_at = new Date().toISOString();
  }
  const keys = Object.keys(f);
  if (keys.length) {
    await q(`UPDATE tasks SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [t.id, ...keys.map(k => f[k])]);
  }
  if (becomingReady || (f.group_id && t.status === 'ready')) {
    const g = await one('SELECT * FROM groups WHERE id = $1', [groupId]);
    if (g && !g.is_personal && g.notify_create) await notifyMembers(groupId, u.id, 'created', t.id, `${u.name}さんが「${f.title ?? t.title}」を設定しました`);
  }
  return { ok: true };
});

route('DELETE', 'tasks/:id', async ({ params }) => {
  const u = await requireUser();
  const t = await requireTask(u.id, params[0]);
  await q('DELETE FROM tasks WHERE id = $1', [t.id]);
  return { ok: true };
});

async function setDone(u: User, t: any, day: string | null, done: boolean) {
  if (t.status === 'draft') throw bad('未記入のメモは、先に詳細を入力してください');
  if (t.repeat) {
    if (!day || !DATE.test(day)) throw bad('日付が必要です');
    if (done) await q('INSERT INTO task_done (task_id, occ_date, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [t.id, day, u.id]);
    else await q('DELETE FROM task_done WHERE task_id = $1 AND occ_date = $2', [t.id, day]);
  } else {
    if (done) await q('UPDATE tasks SET done_at = now(), done_by = $2 WHERE id = $1', [t.id, u.id]);
    else await q('UPDATE tasks SET done_at = null, done_by = null WHERE id = $1', [t.id]);
  }
  if (done && !t.is_personal && t.notify_done) {
    const occ = t.repeat ? day : (t.date ?? nowIn(u.tz).date);
    await notifyMembers(t.group_id, u.id, 'done', t.id, `${u.name}さんが「${t.title}」を完了しました！`, occ);
  }
}

route('POST', 'tasks/:id/done', async ({ body, params }) => {
  const u = await requireUser();
  const t = await requireTask(u.id, params[0]);
  await setDone(u, t, body.day ?? null, body.done !== false);
  return { ok: true };
});

// ---- 買い物リストの品目 -----------------------------------------------------

route('POST', 'tasks/:id/items', async ({ body, params }) => {
  const u = await requireUser();
  const t = await requireTask(u.id, params[0]);
  const labels: string[] = (Array.isArray(body.labels) ? body.labels : [body.label]).map((s: unknown) => str(s, 80)).filter(Boolean);
  if (!labels.length) throw bad('品目を入力してください');
  const max = await one<{ p: number }>('SELECT COALESCE(max(position), -1)::int AS p FROM task_items WHERE task_id = $1', [t.id]);
  for (const [i, label] of labels.entries()) await q('INSERT INTO task_items (task_id, label, position) VALUES ($1,$2,$3)', [t.id, label, max!.p + 1 + i]);
  // 品目を足したら、完了済みの買い物はもう一度「未完了」に戻す
  if (t.done_at) await q('UPDATE tasks SET done_at = null, done_by = null WHERE id = $1', [t.id]);
  return { ok: true };
});

route('PATCH', 'items/:id', async ({ body, params }) => {
  const u = await requireUser();
  const item = await one('SELECT * FROM task_items WHERE id = $1', [params[0]]);
  if (!item) throw notFound();
  const t = await requireTask(u.id, item.task_id);
  if ('label' in body) await q('UPDATE task_items SET label = $2 WHERE id = $1', [item.id, str(body.label, 80) || item.label]);
  let completed = false;
  if ('checked' in body) {
    await q('UPDATE task_items SET checked = $2 WHERE id = $1', [item.id, !!body.checked]);
    const left = await one<{ n: number }>('SELECT count(*) FILTER (WHERE NOT checked)::int AS n FROM task_items WHERE task_id = $1', [t.id]);
    // 全部チェックしたら、買い物タスクは自動で完了
    if (left!.n === 0 && !t.repeat && !t.done_at && t.status === 'ready') {
      await setDone(u, t, null, true);
      completed = true;
    } else if (left!.n > 0 && t.done_at) {
      await q('UPDATE tasks SET done_at = null, done_by = null WHERE id = $1', [t.id]);
    }
  }
  return { ok: true, completed };
});

route('DELETE', 'items/:id', async ({ params }) => {
  const u = await requireUser();
  const item = await one('SELECT * FROM task_items WHERE id = $1', [params[0]]);
  if (!item) throw notFound();
  await requireTask(u.id, item.task_id);
  await q('DELETE FROM task_items WHERE id = $1', [item.id]);
  return { ok: true };
});

// ---- リアクション -----------------------------------------------------------

route('POST', 'reactions', async ({ body }) => {
  const u = await requireUser();
  const t = await requireTask(u.id, String(body.task_id));
  if (!EMOJIS.includes(body.emoji)) throw bad('その絵文字は使えません');
  const day = DATE.test(body.occ_date || '') ? body.occ_date : (t.date ?? nowIn(u.tz).date);
  const r = await q('INSERT INTO reactions (task_id, occ_date, user_id, emoji) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING task_id', [t.id, day, u.id, body.emoji]);
  if (r.length) {
    const doer = t.repeat ? (await one('SELECT user_id FROM task_done WHERE task_id = $1 AND occ_date = $2', [t.id, day]))?.user_id : t.done_by;
    const target = doer || t.user_id;
    if (target !== u.id) {
      await q('INSERT INTO notifications (user_id, kind, actor_id, task_id, occ_date, body) VALUES ($1, $2, $3, $4, $5, $6)',
        [target, 'reaction', u.id, t.id, day, `${u.name}さんが「${t.title}」に ${body.emoji}`]);
    }
  }
  return { ok: true };
});

// ---- グループ ---------------------------------------------------------------

route('POST', 'groups', async ({ body }) => {
  const u = await requireUser();
  const name = str(body.name, 40);
  if (!name) throw bad('グループ名を入力してください');
  const g = await tx(async c => {
    const g = (await c.query('INSERT INTO groups (name, description, color, owner_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [name, str(body.description, 200), COLORS.test(body.color) ? body.color : '#2BA0FF', u.id])).rows[0];
    await c.query('INSERT INTO memberships (group_id, user_id) VALUES ($1,$2)', [g.id, u.id]);
    return g;
  });
  return g;
});

route('PATCH', 'groups/:id', async ({ body, params }) => {
  const u = await requireUser();
  const g = await requireMember(u.id, params[0]);
  const name = 'name' in body ? str(body.name, 40) || g.name : g.name;
  await q(`UPDATE groups SET name = $2, description = $3, color = $4, notify_create = $5, notify_done = $6 WHERE id = $1`, [
    g.id, name,
    'description' in body ? str(body.description, 200) : g.description,
    COLORS.test(body.color) ? body.color : g.color,
    'notify_create' in body ? !!body.notify_create : g.notify_create,
    'notify_done' in body ? !!body.notify_done : g.notify_done,
  ]);
  return { ok: true };
});

route('POST', 'groups/:id/leave', async ({ params }) => {
  const u = await requireUser();
  const g = await requireMember(u.id, params[0]);
  if (g.is_personal) throw bad('個人グループからは抜けられません');
  await q('DELETE FROM memberships WHERE group_id = $1 AND user_id = $2', [g.id, u.id]);
  const left = await one<{ n: number }>('SELECT count(*)::int AS n FROM memberships WHERE group_id = $1', [g.id]);
  if (!left!.n) await q('DELETE FROM groups WHERE id = $1', [g.id]);
  return { ok: true };
});

route('GET', 'invite/:token', async ({ params }) => {
  const g = await one<{ name: string; color: string; n: number }>(
    `SELECT g.name, g.color, (SELECT count(*)::int FROM memberships m WHERE m.group_id = g.id) AS n
       FROM groups g WHERE g.invite_token = $1 AND NOT g.is_personal`, [params[0]]);
  if (!g) throw notFound();
  return g;
});

route('POST', 'invite/:token/join', async ({ params }) => {
  const u = await requireUser();
  const g = await one<{ id: string }>('SELECT id FROM groups WHERE invite_token = $1 AND NOT is_personal', [params[0]]);
  if (!g) throw notFound();
  await q('INSERT INTO memberships (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [g.id, u.id]);
  return { id: g.id };
});

// ---- 持ち物チェックリスト ----------------------------------------------------

async function requireChecklist(userId: string, id: string) {
  const c = await one('SELECT * FROM checklists WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!c) throw notFound();
  return c;
}

async function saveChecklistItems(checklistId: string, items: unknown) {
  if (!Array.isArray(items)) return;
  const keep: string[] = [];
  for (const [i, it] of items.entries()) {
    const label = str((it as any)?.label, 80);
    if (!label) continue;
    const id = (it as any)?.id;
    if (id) {
      const r = await q('UPDATE checklist_items SET label = $3, position = $4 WHERE id = $1 AND checklist_id = $2 RETURNING id', [id, checklistId, label, i]);
      if (r.length) { keep.push(id); continue; }
    }
    const r = await one<{ id: string }>('INSERT INTO checklist_items (checklist_id, label, position) VALUES ($1,$2,$3) RETURNING id', [checklistId, label, i]);
    keep.push(r!.id);
  }
  await q('DELETE FROM checklist_items WHERE checklist_id = $1 AND NOT (id = ANY($2::uuid[]))', [checklistId, keep]);
}

function cleanChecklist(b: any) {
  return {
    name: str(b.name, 40),
    trigger: ['time', 'after_shopping', 'manual'].includes(b.trigger) ? b.trigger : 'manual',
    show_at: TIME.test(b.show_at || '') ? b.show_at : null,
    weekdays: Array.isArray(b.weekdays) ? b.weekdays.map(Number).filter((n: number) => n >= 0 && n <= 6) : [0, 1, 2, 3, 4, 5, 6],
  };
}

route('POST', 'checklists', async ({ body }) => {
  const u = await requireUser();
  const c = cleanChecklist(body);
  if (!c.name) throw bad('名前を入力してください');
  const r = await one<{ id: string }>(
    `INSERT INTO checklists (user_id, name, trigger, show_at, weekdays, position)
     VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(max(position),0)+1 FROM checklists WHERE user_id = $1)) RETURNING id`,
    [u.id, c.name, c.trigger, c.show_at, c.weekdays]);
  await saveChecklistItems(r!.id, body.items);
  return r;
});

route('PATCH', 'checklists/:id', async ({ body, params }) => {
  const u = await requireUser();
  const cur = await requireChecklist(u.id, params[0]);
  const c = cleanChecklist({ ...cur, ...body });
  await q('UPDATE checklists SET name = $2, trigger = $3, show_at = $4, weekdays = $5 WHERE id = $1', [cur.id, c.name || cur.name, c.trigger, c.show_at, c.weekdays]);
  await saveChecklistItems(cur.id, body.items);
  return { ok: true };
});

route('DELETE', 'checklists/:id', async ({ params }) => {
  const u = await requireUser();
  const c = await requireChecklist(u.id, params[0]);
  await q('DELETE FROM checklists WHERE id = $1', [c.id]);
  return { ok: true };
});

route('POST', 'checklist-items/:id/check', async ({ body, params }) => {
  const u = await requireUser();
  const it = await one('SELECT i.id FROM checklist_items i JOIN checklists c ON c.id = i.checklist_id WHERE i.id = $1 AND c.user_id = $2', [params[0], u.id]);
  if (!it) throw notFound();
  const day = DATE.test(body.day || '') ? body.day : nowIn(u.tz).date;
  if (body.checked) await q('INSERT INTO checklist_checks (item_id, day) VALUES ($1,$2) ON CONFLICT DO NOTHING', [it.id, day]);
  else await q('DELETE FROM checklist_checks WHERE item_id = $1 AND day = $2', [it.id, day]);
  return { ok: true };
});

// ---- お知らせ・プッシュ通知 ---------------------------------------------------

route('POST', 'notifications/read', async ({ body }) => {
  const u = await requireUser();
  if (Array.isArray(body.ids) && body.ids.length) {
    await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL', [u.id, body.ids.map(Number)]);
  } else {
    await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [u.id]);
  }
  return { ok: true };
});

route('POST', 'push/subscribe', async ({ body }) => {
  const u = await requireUser();
  const s = body.subscription;
  if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) throw bad('購読情報が不正です');
  await q(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES ($1,$2,$3,$4)
           ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, p256dh = $3, auth = $4`, [s.endpoint, u.id, s.keys.p256dh, s.keys.auth]);
  return { ok: true };
});

route('POST', 'push/unsubscribe', async ({ body }) => {
  const u = await requireUser();
  await q('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [str(body.endpoint, 1000), u.id]);
  return { ok: true };
});

route('POST', 'push/test', async () => {
  const u = await requireUser();
  const n = await pushTo(u.id, { title: '🔔 テスト通知', body: 'この端末に通知が届きました', url: '/' });
  return { sent: n };
});

// 1分ごとに外部のスケジューラから呼ぶ（README 参照）
route('GET', 'cron', async ({ req, url }) => {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('key');
  if (!secret || given !== secret) throw new HttpError(401, 'unauthorized');
  return runDueReminders();
});

// ---------------------------------------------------------------- 入口

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join('/');
  const url = new URL(req.url);
  let body: any = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try { body = await req.json(); } catch { body = {}; }
  }
  for (const [method, re, h] of routes) {
    if (method !== req.method) continue;
    const m = path.match(re);
    if (!m) continue;
    try {
      const res = await h({ req, body, params: m.slice(1).map(decodeURIComponent), url });
      return NextResponse.json(res ?? { ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e: any) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e?.code === '22P02') return NextResponse.json({ error: '見つかりません' }, { status: 404 }); // 不正な uuid
      console.error(e);
      return NextResponse.json({ error: 'サーバーでエラーが起きました' }, { status: 500 });
    }
  }
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
