import { after, NextRequest, NextResponse } from 'next/server';
import { clearNextAt, kvName } from '@/lib/kv';
import { q, one, tx, databaseUrl, pool, ready } from '@/lib/db';
import { consumeLinkCode, createSession, currentUser, destroySession, issueLinkCode, sessionTokenHash, touchSession, type User } from '@/lib/auth';
import { loadState } from '@/lib/state';
import { pushEnabled, pushTo, runDueReminders, vapid, vapidProblem } from '@/lib/notify';
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

/**
 * 同じグループの他のメンバーに、付箋のお知らせを入れる。
 * only を渡したら、その人たちだけに（予定を「表示する人」に選ばれた人）
 */
async function notifyMembers(groupId: string, actorId: string, kind: string, taskId: string, body: string, occDate: string | null = null, only: string[] | null = null) {
  await q(
    `INSERT INTO notifications (user_id, kind, actor_id, task_id, occ_date, body)
     SELECT m.user_id, $3, $2, $4, $5, $6 FROM memberships m
      WHERE m.group_id = $1 AND m.user_id <> $2 AND ($7::uuid[] IS NULL OR m.user_id = ANY($7::uuid[]))`,
    [groupId, actorId, kind, taskId, occDate, body, only]);
}

/**
 * 予定を「表示する人」を整える。
 * 個人グループ → いつも NULL（自分だけのグループなので）
 * 共通（'all' や null）→ NULL ＝ グループの全員
 * 人を選んだとき → そのグループのメンバーだけに絞る。誰もいなければ作った本人
 */
async function cleanAssignees(groupId: string, isPersonal: boolean, raw: unknown, fallbackUser: string): Promise<string[] | null> {
  if (isPersonal || raw === null || raw === 'all' || raw === undefined) return null;
  const ids = Array.isArray(raw) ? [...new Set(raw.map(String))] : [];
  if (!ids.length) return [fallbackUser];
  const rows = await q<{ user_id: string }>(
    'SELECT user_id FROM memberships WHERE group_id = $1 AND user_id = ANY($2::uuid[])', [groupId, ids]).catch(() => []);
  const ok = rows.map(r => r.user_id);
  return ok.length ? ok : [fallbackUser];
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
  // 複数日の予定：始まりより後の日だけ。繰り返しとは一緒に使わない
  if (has('end_date')) out.end_date = b.end_date && DATE.test(b.end_date) && out.date && b.end_date > (out.date as string) && !b.repeat ? b.end_date : null;
  if (has('time')) out.time = b.time && TIME.test(b.time) ? b.time : null;
  if (has('duration_min')) out.duration_min = Math.min(24 * 60, Math.max(5, Number(b.duration_min) || 60));
  if (has('reminders')) out.reminders = Array.isArray(b.reminders) ? [...new Set(b.reminders.map(String))].filter(r => REMINDERS.includes(r as string)) : [];
  if (has('remind_all')) out.remind_all = !!b.remind_all;
  if (has('starred')) out.starred = !!b.starred;
  if (has('repeat')) {
    const r = b.repeat;
    if (r && ['daily', 'weekly', 'monthly'].includes(r.freq)) {
      out.repeat = JSON.stringify({
        freq: r.freq,
        interval: Math.min(12, Math.max(1, Number(r.interval) || 1)),
        weekdays: Array.isArray(r.weekdays) ? r.weekdays.map(Number).filter((n: number) => n >= 0 && n <= 6) : [],
        monthMode: r.monthMode === 'nth' ? 'nth' : 'day',
        until: r.until && DATE.test(r.until) ? r.until : null,
        except: Array.isArray(r.except) ? [...new Set(r.except.filter((d: unknown) => typeof d === 'string' && DATE.test(d)))].sort().slice(-300) : [],
      });
    } else out.repeat = null;
  }
  return out;
}

/** そのグループの種類なら id を、違えば null を返す */
async function kindIdFor(groupId: string, kindId: unknown): Promise<string | null> {
  if (!kindId || typeof kindId !== 'string') return null;
  const k = await one<{ id: string }>('SELECT id FROM task_kinds WHERE id = $1 AND group_id = $2', [kindId, groupId]).catch(() => null);
  return k?.id ?? null;
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
    throw new HttpError(409, 'この名前はすでに使われています。自分の名前なら、使っている端末の「設定 → ほかの端末で使う」で6桁のコードを出して、「コードでログイン」から入ってください。');
  }
  const user = await tx(async c => {
    const u = (await c.query('INSERT INTO users (name, tz) VALUES ($1, $2) RETURNING id', [name, tz])).rows[0];
    const g = (await c.query(
      `INSERT INTO groups (name, color, is_personal, owner_id, notify_create, notify_done)
       VALUES ('個人（自分専用）', '#F5E211', true, $1, false, false) RETURNING id`, [u.id])).rows[0];
    await c.query('INSERT INTO memberships (group_id, user_id) VALUES ($1, $2)', [g.id, u.id]);
    // よく使うリストを最初から用意しておく（テンプレート）
    const seeds: [string, string, string | null, string[]][] = [
      ['家を出る時', 'time', '07:00', ['財布', 'スマホ', '鍵', '社員証', '傘（天気を確認）', 'ゴミ']],
      ['お店を出る時', 'manual', null, ['傘', '買った物', 'レシート']],
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
  if ('review_skip' in body) await q('UPDATE users SET review_skip = $1 WHERE id = $2', [!!body.review_skip, u.id]);
  return { ok: true };
});

// ---- 全データ（画面の表示用） -----------------------------------------------

route('GET', 'state', async ({ url }) => {
  const tokenHash = await sessionTokenHash();
  if (!tokenHash) return { me: null };
  const day = DATE.test(url.searchParams.get('day') || '') ? url.searchParams.get('day') : null;
  // ログインの確認も含めて、1回の問い合わせでまとめて取る（lib/state.ts）
  const st = await loadState(tokenHash, day);
  if (!st.me) return { me: null };
  await touchSession(st.me.last_used_at);
  const { last_used_at, ...me } = st.me;
  return { ...st, me, pushKey: pushEnabled() ? vapid().publicKey : null, build: process.env.NEXT_PUBLIC_BUILD };
});

// ---- タスク ---------------------------------------------------------------

route('POST', 'tasks', async ({ body }) => {
  const u = await requireUser();
  // ワンボタンメモ：ひとことだけ（空でもOK）で、自分専用の未記入メモにする
  if (body.quick) {
    const t = await one('INSERT INTO tasks (user_id, group_id, status, title, description, reminders) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [u.id, await personalGroupId(u.id), 'draft', str(body.title, 120), str(body.description, 2000), '{}']);
    return t;
  }
  const groupId = body.group_id ? String(body.group_id) : await personalGroupId(u.id);
  const g = await requireMember(u.id, groupId);
  const f = cleanTask(body, false);
  if (!f.title) throw bad('タイトルを入力してください');
  const kindId = await kindIdFor(groupId, body.kind_id);
  // 表示する人：指定がなければ「自分だけ」（共通にするときは 'all'）
  const assignees = await cleanAssignees(groupId, g.is_personal, 'assignees' in body ? body.assignees : [u.id], u.id);
  const t = await one<{ id: string }>(
    `INSERT INTO tasks (user_id, group_id, status, title, description, kind, kind_id, assignees, color, date, end_date, time, duration_min, reminders, remind_all, repeat, starred, detailed_at)
     VALUES ($1,$2,'ready',$3,$4,$5,$6,$7,$8,$9,$16,$10,$11,$12,$13,$14,$15, now()) RETURNING id`,
    [u.id, groupId, f.title, f.description, kindId ? 'general' : f.kind, kindId, assignees, f.color, f.date, f.time, f.duration_min, f.reminders, f.remind_all, f.repeat, f.starred, f.end_date]);
  if (Array.isArray(body.items)) {
    for (const [i, label] of body.items.map((s: unknown) => str(s, 80)).filter(Boolean).entries()) {
      await q('INSERT INTO task_items (task_id, label, position) VALUES ($1,$2,$3)', [t!.id, label, i]);
    }
  }
  if (!g.is_personal && g.notify_create) await notifyMembers(groupId, u.id, 'created', t!.id, `${u.name}さんが「${f.title}」を設定しました`, null, assignees);
  return t;
});

route('PATCH', 'tasks/:id', async ({ body, params }) => {
  const u = await requireUser();
  await patchTask(u, await requireTask(u.id, params[0]), body);
  return { ok: true };
});

/** 予定を書き換える（PATCH と、繰り返しの「この日だけ／この日以降」で共通） */
async function patchTask(u: User, t: any, body: any) {
  const f = cleanTask(body, true);
  let groupId = t.group_id;
  if (body.group_id && body.group_id !== t.group_id) {
    await requireMember(u.id, body.group_id);
    groupId = body.group_id;
    f.group_id = groupId;
  }
  // 自分たちで足した種類：そのグループのものだけ使える。グループを移したら外す
  if ('kind_id' in body) {
    f.kind_id = await kindIdFor(groupId, body.kind_id);
    if (f.kind_id) f.kind = 'general';
  } else if (t.kind_id && groupId !== t.group_id) {
    f.kind_id = await kindIdFor(groupId, t.kind_id);
  }
  // 表示する人：指定があれば整える。グループを移したら、新しいグループに合わせて整え直す
  const targetGroup = groupId === t.group_id ? { is_personal: t.is_personal } : await one('SELECT is_personal FROM groups WHERE id = $1', [groupId]);
  if ('assignees' in body || groupId !== t.group_id) {
    f.assignees = await cleanAssignees(groupId, !!targetGroup?.is_personal, 'assignees' in body ? body.assignees : (t.assignees ?? 'all'), u.id);
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
    if (g && !g.is_personal && g.notify_create) {
      const who = 'assignees' in f ? (f.assignees as string[] | null) : t.assignees;
      await notifyMembers(groupId, u.id, 'created', t.id, `${u.name}さんが「${f.title ?? t.title}」を設定しました`, null, who);
    }
  }
}

/**
 * 繰り返しの予定の一部だけを変える・消す。
 * scope = 'one'：その日だけ（繰り返しからその日を外し、変更するならその日だけの予定を別に作る）
 * scope = 'following'：その日以降すべて（元の繰り返しは前の日で終わらせ、変更するならその日から新しい繰り返しを作る）
 * 完了の記録・絵文字・「完了しましたか？」の返事は、新しい予定に移す。「すべて」はふつうの PATCH / DELETE を使う
 */
route('POST', 'tasks/:id/split', async ({ body, params }) => {
  const u = await requireUser();
  const t = await requireTask(u.id, params[0]);
  const day = String(body.day || '');
  const scope = body.scope === 'one' ? 'one' : body.scope === 'following' ? 'following' : null;
  if (!t.repeat || !DATE.test(day) || !scope) throw bad('繰り返しの予定と日付を指定してください');
  // pg は日付をサーバーの時刻の0時の Date で返すので、その日付のまま文字にする
  const d0 = t.date as Date | string;
  const start = d0 instanceof Date ? `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}` : String(d0).slice(0, 10);
  if (day < start) throw bad('繰り返しが始まる前の日です');
  const rep = { ...t.repeat, except: [...(t.repeat.except || [])] };
  const remove = !!body.delete;

  // この日以降を最初の日から → すべてと同じ
  if (scope === 'following' && day === start) {
    if (remove) { await q('DELETE FROM tasks WHERE id = $1', [t.id]); return { ok: true }; }
    await patchTask(u, t, body);
    return { ok: true, id: t.id };
  }

  const prevDay = new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const parentRepeat = scope === 'one'
    ? { ...rep, except: [...new Set([...rep.except, day])].sort() }
    : { ...rep, until: prevDay, except: rep.except.filter((d: string) => d < day) };
  const newId = await tx(async c => {
    await c.query('UPDATE tasks SET repeat = $2, updated_at = now() WHERE id = $1', [t.id, JSON.stringify(parentRepeat)]);
    const range = scope === 'one' ? 'occ_date = $2' : 'occ_date >= $2';
    if (remove) {
      for (const tbl of ['task_done', 'reactions', 'task_followups']) await c.query(`DELETE FROM ${tbl} WHERE task_id = $1 AND ${range}`, [t.id, day]);
      return null;
    }
    // 元の予定を写して、新しい予定を作る
    const copyRepeat = scope === 'one' ? null : JSON.stringify({ ...rep, except: rep.except.filter((d: string) => d >= day) });
    const n = (await c.query(
      `INSERT INTO tasks (user_id, group_id, status, title, description, kind, kind_id, assignees, color, date, time, duration_min, reminders, remind_all, repeat, starred, captured_at, detailed_at)
       SELECT user_id, group_id, status, title, description, kind, kind_id, assignees, color, $2, time, duration_min, reminders, remind_all, $3, starred, captured_at, detailed_at
         FROM tasks WHERE id = $1 RETURNING id`, [t.id, day, copyRepeat])).rows[0].id as string;
    if (scope === 'one') {
      // その日の完了は、ふつうの予定の完了にする
      const d = (await c.query('DELETE FROM task_done WHERE task_id = $1 AND occ_date = $2 RETURNING user_id, done_at', [t.id, day])).rows[0];
      if (d) await c.query('UPDATE tasks SET done_at = $2, done_by = $3 WHERE id = $1', [n, d.done_at, d.user_id]);
    } else {
      await c.query(`UPDATE task_done SET task_id = $3 WHERE task_id = $1 AND ${range}`, [t.id, day, n]);
    }
    await c.query(`UPDATE reactions SET task_id = $3 WHERE task_id = $1 AND ${range}`, [t.id, day, n]);
    await c.query(`UPDATE task_followups SET task_id = $3 WHERE task_id = $1 AND ${range}`, [t.id, day, n]);
    return n;
  });
  if (!newId) return { ok: true };
  // 新しい予定に、入力画面で変えた内容を入れる（「この日だけ」は繰り返さない）
  const changes = { ...body };
  delete changes.day; delete changes.scope; delete changes.delete;
  if (scope === 'one') changes.repeat = null;
  else if (changes.repeat) changes.repeat = { ...changes.repeat, except: rep.except.filter((d: string) => d >= day) };
  await patchTask(u, await requireTask(u.id, newId), changes);
  return { ok: true, id: newId };
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

// 「完了しましたか？」への返事：later ＝ まだ（15分後にもう一度）、hold ＝ 保留（もう聞かない）、clear ＝ 取り消し
route('POST', 'tasks/:id/followup', async ({ body, params }) => {
  const u = await requireUser();
  const t = await requireTask(u.id, params[0]);
  const day = DATE.test(body.day || '') ? body.day : nowIn(u.tz).date;
  if (body.action === 'later') {
    await q(`INSERT INTO task_followups (task_id, occ_date, state, snooze_count, next_at) VALUES ($1, $2, 'snoozed', 1, now() + interval '15 minutes')
             ON CONFLICT (task_id, occ_date) DO UPDATE SET state = 'snoozed', snooze_count = task_followups.snooze_count + 1,
               next_at = now() + interval '15 minutes', updated_at = now()`, [t.id, day]);
  } else if (body.action === 'hold') {
    await q(`INSERT INTO task_followups (task_id, occ_date, state, next_at) VALUES ($1, $2, 'held', null)
             ON CONFLICT (task_id, occ_date) DO UPDATE SET state = 'held', next_at = null, updated_at = now()`, [t.id, day]);
  } else if (body.action === 'clear') {
    await q('DELETE FROM task_followups WHERE task_id = $1 AND occ_date = $2', [t.id, day]);
  } else throw bad('返事の種類が不正です');
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
    await q('UPDATE task_items SET checked = $2, checked_by = $3, checked_at = CASE WHEN $2 THEN now() ELSE null END WHERE id = $1',
      [item.id, !!body.checked, body.checked ? u.id : null]);
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

// チェック済みの品目をまとめて片付ける
route('POST', 'tasks/:id/items/clear-checked', async ({ params }) => {
  const u = await requireUser();
  const t = await requireTask(u.id, params[0]);
  await q('DELETE FROM task_items WHERE task_id = $1 AND checked', [t.id]);
  return { ok: true };
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

// ---- グループで共有する、自分たちで足したタスクの種類
route('POST', 'groups/:id/kinds', async ({ body, params }) => {
  const u = await requireUser();
  const g = await requireMember(u.id, params[0]);
  const name = str(body.name, 20);
  if (!name) throw bad('種類の名前を入力してください');
  if (Object.values(KIND_PRESETS).some(k => k.label === name)) throw bad(`「${name}」はもともとある種類です`);
  const r = await one<{ id: string }>(
    'INSERT INTO task_kinds (group_id, name, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id', [g.id, name, u.id]);
  if (!r) throw bad(`「${name}」はもうこのグループにあります`);
  return r;
});

route('DELETE', 'kinds/:id', async ({ params }) => {
  const u = await requireUser();
  const k = await one<{ id: string; group_id: string }>('SELECT id, group_id FROM task_kinds WHERE id = $1', [params[0]]);
  if (!k) throw notFound();
  await requireMember(u.id, k.group_id);
  await q('DELETE FROM task_kinds WHERE id = $1', [k.id]); // 使っていたタスクは「一般」に戻る
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
  const problem = vapidProblem();
  if (problem) throw bad('サーバーの通知の鍵：' + problem);
  const errors: string[] = [];
  const n = await pushTo(u.id, { title: '🔔 テスト通知', body: 'この端末に通知が届きました', url: '/' }, errors);
  const subs = await one<{ n: number }>('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [u.id]);
  return { sent: n, devices: subs?.n ?? 0, error: errors[0] || null };
});

// 1分ごとに外部のスケジューラから呼ぶ（README 参照）
// 設定の確認ページ：スマホで開くだけで、どこが足りないか分かる（秘密の値そのものは出さない）
route('GET', 'health', async () => {
  const db = databaseUrl();
  const checks: Record<string, string> = {
    'データベースの接続先': db ? `OK（${db.name}）` : 'NG：DATABASE_URL がありません。Vercel の Storage で Neon を追加し、Redeploy してください',
    'プッシュ通知の鍵': vapidProblem() || 'OK',
    '通知の送り元（VAPID_SUBJECT）': process.env.VAPID_SUBJECT ? `OK（${vapid().subject}）` : '未設定（なくても動きます）',
    '時間どおりの通知の合言葉（CRON_SECRET）': process.env.CRON_SECRET ? 'OK' : '未設定（なくても動きます）',
    '通知の時刻の保存場所（Upstash Redis）': kvName() ? `OK（${kvName()}）` : '未設定：Vercel の Storage で Upstash Redis を追加すると、通知の呼び出しでデータベースを起こさずに済みます（Neon の無料枠の節約）',
  };
  if (db) {
    try {
      await pool().query('SELECT 1');
      checks['データベースにつながるか'] = 'OK';
      const times: number[] = [];
      for (let i = 0; i < 3; i++) { const t0 = Date.now(); await pool().query('SELECT 1'); times.push(Date.now() - t0); }
      const rtt = Math.min(...times);
      const host = (() => { try { return new URL(db.url).hostname; } catch { return ''; } })();
      const dbRegion = host.match(/\.([a-z]{2}-[a-z]+-\d)\.aws/)?.[1] || host.match(/\.(aws-[a-z0-9-]+|azure-[a-z0-9-]+)\./)?.[1] || '不明';
      checks['サーバーの場所（Vercel）'] = process.env.VERCEL_REGION || '不明（手元で実行中）';
      checks['データベースの場所（Neon）'] = dbRegion;
      checks['サーバー⇔DBの1往復'] = `${rtt}ms${rtt > 80 ? '（遠いです。Vercel の Settings → Functions → Function Region を、データベースの場所に近い地域にすると速くなります）' : '（十分速いです）'}`;
      try {
        await ready();
        const r = await pool().query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
        checks['表（テーブル）の準備'] = `OK（${r.rows[0].n}個）`;
      } catch (e: any) {
        checks['表（テーブル）の準備'] = 'NG：' + String(e?.message || e).slice(0, 200);
      }
    } catch (e: any) {
      checks['データベースにつながるか'] = 'NG：' + String(e?.message || e).slice(0, 200);
    }
  }
  const ok = Object.values(checks).every(v => !v.startsWith('NG'));
  return { ok, checks };
});

route('GET', 'cron', async ({ req, url }) => {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('key');
  if (!secret || given !== secret) throw new HttpError(401, 'unauthorized');
  return runDueReminders(Date.now(), url.searchParams.get('force') === '1');
});

const esc = (v: string) => v.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function healthHtml(r: { ok: boolean; checks: Record<string, string> }) {
  const rows = Object.entries(r.checks).map(([k, v]) => {
    const bad = v.startsWith('NG');
    const warn = !bad && !v.startsWith('OK') && !/^\d/.test(v) && !/^[a-z]{2,4}\d/.test(v);
    return `<tr><th>${esc(k)}</th><td class="${bad ? 'ng' : warn ? 'warn' : 'ok'}">${esc(v)}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>設定の確認</title>
<style>body{font-family:system-ui,sans-serif;background:#F5F1E4;color:#2C2E2A;margin:0;padding:20px}h1{font-size:22px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden}
th,td{text-align:left;padding:12px;border-bottom:1px solid #eee;font-size:14px;vertical-align:top}th{width:38%;font-weight:600}.ng{color:#d23b2a;font-weight:600}.warn{color:#9a6a00}.ok{color:#2C2E2A}</style></head>
<body><h1>${r.ok ? '設定は動いています' : '直すところがあります'}</h1><table>${rows}</table></body></html>`;
}

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
      // 予定・メモ・リストなどを書き換えたら、次に通知を送る時刻を計算し直させる（返事を待たせないよう、返したあとで）
      if (req.method !== 'GET' && path !== 'cron') after(() => clearNextAt());
      // 設定の確認ページをブラウザで開いたときは、読みやすい表にする
      if (path === 'health' && (req.headers.get('accept') || '').includes('text/html')) {
        return new NextResponse(healthHtml(res as { ok: boolean; checks: Record<string, string> }), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      // 文字の種類（UTF-8）を明記する（書かないと、ブラウザによっては日本語が文字化けする）
      return NextResponse.json(res ?? { ok: true }, { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } });
    } catch (e: any) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e?.code === '22P02') return NextResponse.json({ error: '見つかりません' }, { status: 404 }); // 不正な uuid
      console.error(e);
      // 原因の手がかりを短く添える（設定の確認は /api/health）
      const hint = String(e?.message || '').slice(0, 120);
      return NextResponse.json({ error: `サーバーでエラーが起きました${hint ? '：' + hint : ''}（設定の確認：/api/health）` }, { status: 500 });
    }
  }
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
