// デモ版：本物のAPIと同じ形で答える、ブラウザ内だけの擬似サーバー
// （データはページを開いている間だけ。再読み込みで最初に戻る）
import { addDays, KIND_PRESETS, weekday } from '../lib/time';
import { ApiError } from '../app/lib';

type Any = Record<string, any>;

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
let seq = 100;
const id = () => 'id' + seq++;

const T = today();
const mon = addDays(T, -((weekday(T) + 6) % 7));
const sat = addDays(mon, 5);

const users: Any = { me: 'りょう', u2: '鈴木花子', u3: '佐藤次郎', u4: '母' };
const groups: Any[] = [
  { id: 'gp', name: '個人（自分専用）', description: '', color: '#F5E211', is_personal: true, owner_id: 'me', notify_create: false, notify_done: false, invite_token: null, m: ['me'] },
  { id: 'gf', name: '家族', description: '', color: '#FF705D', is_personal: false, owner_id: 'u4', notify_create: true, notify_done: true, invite_token: 'demo-family', m: ['me', 'u4'] },
  { id: 'gw', name: '営業チーム', description: '', color: '#2BA0FF', is_personal: false, owner_id: 'u2', notify_create: true, notify_done: true, invite_token: 'demo-sales', m: ['me', 'u2', 'u3'] },
];

function task(p: Any): Any {
  return {
    id: id(), user_id: 'me', group_id: 'gp', status: 'ready', title: '', description: '', kind: 'general', color: null,
    kind_id: null, assignees: null, starred: false, date: null, time: null, duration_min: 60, reminders: KIND_PRESETS[p.kind || 'general'].reminders, remind_all: false, repeat: null,
    captured_at: ago(60 * 24), detailed_at: ago(60 * 24), done_at: null, done_by: null, updated_at: ago(60), ...p,
  };
}

// デモを開いた時刻に合わせて「今やっていること」が出るように
const H = new Date().getHours();
const hh = (h: number) => `${String(Math.max(0, Math.min(23, h))).padStart(2, '0')}:00`;
const report = task({ group_id: 'gw', user_id: 'u2', assignees: ['u2'], title: '資料作成', date: T, time: '13:00', duration_min: 90, done_at: ago(2), done_by: 'u2' });
const review = task({ group_id: 'gw', user_id: 'u3', assignees: ['u3', 'me'], title: '企画書レビュー', kind: 'meeting', date: T, time: '15:30', description: '第3会議室' });
const duty = task({ group_id: 'gw', assignees: ['me'], title: '朝当番', kind: 'duty', date: mon, time: '08:00', duration_min: 30, repeat: { freq: 'weekly', interval: 1, weekdays: [1, 4], monthMode: 'day', until: null } });

const tasks: Any[] = [
  duty, report, review,
  task({ group_id: 'gw', starred: true, title: '定例会議', kind: 'meeting', date: mon, time: '10:00', description: '営業部との定例', repeat: { freq: 'weekly', interval: 1, weekdays: [1, 3], monthMode: 'day', until: null } }),
  task({ group_id: 'gf', user_id: 'u4', title: 'ゴミ出し', kind: 'duty', date: mon, time: '07:30', duration_min: 15, remind_all: true, repeat: { freq: 'weekly', interval: 1, weekdays: [2, 5], monthMode: 'day', until: null } }),
  task({ title: '歯医者', kind: 'reminder', date: addDays(T, 1), time: '18:30' }),
  task({ title: 'ランニング', date: addDays(T, 2), time: '06:30', duration_min: 45, color: '#EBC1FF' }),
  task({ group_id: 'gw', user_id: 'u2', assignees: ['u2'], title: '見積書を送る', date: addDays(T, 1), time: '11:00', duration_min: 30 }),
  task({ group_id: 'gw', user_id: 'u3', assignees: ['u3'], title: 'B社・C社 外回り', kind_id: 'k1', date: T, time: hh(H), duration_min: 150 }),
  task({ group_id: 'gw', user_id: 'u2', assignees: ['u2'], title: '提案書づくり', date: T, time: hh(H + 2), duration_min: 90 }),
  task({ group_id: 'gw', assignees: ['me'], title: 'A社訪問', kind_id: 'k1', date: T, time: '11:30', duration_min: 60 }),
  task({ group_id: 'gf', title: '週末キャンプ（道志）', date: sat, color: '#8ED462', description: '10時に出発' }),
  task({ title: 'ランタンの電池を買う' }),
  task({ title: 'キャンプ場の予約を確認' }),
  task({ status: 'draft', title: '田中さんに電話', description: '見積もりの件。金曜までに折り返し', captured_at: ago(25), detailed_at: null, reminders: [] }),
  task({ status: 'draft', title: 'テントのペグを買い足す', description: '鍛造ペグ 8本\nハンマーも見る', captured_at: ago(60 * 5), detailed_at: null, reminders: [] }),
  task({ status: 'draft', title: '会議で出たアイデア', description: '朝礼を5分短くする', captured_at: ago(60 * 26), detailed_at: null, reminders: [] }),
  // 終わってから30分以上たったのに、まだ完了していない予定（「完了しましたか？」が出る）
  task({ title: '週報の下書き', date: T, time: hh(H - 2), duration_min: 60 }),
  task({ title: '朝のメール返信', date: T, time: hh(Math.max(1, H - 4)), duration_min: 60, done_at: new Date(Date.now() - (4 * 60 - 25) * 60000).toISOString(), done_by: 'me' }),
  task({ group_id: 'gw', assignees: ['me'], starred: true, title: '提案資料の仕上げ', date: T, time: hh(Math.max(0, H - 3)), duration_min: 90, done_at: new Date(Date.now() - (3 * 60 - 40) * 60000).toISOString(), done_by: 'me', captured_at: ago(60 * 5) }),
];
// 過去の分の完了
const done: Any[] = [];
for (let d = mon; d < T; d = addDays(d, 1)) if ([1, 4].includes(weekday(d))) done.push({ task_id: duty.id, occ_date: d, user_id: 'me' });

const items: Any[] = [];
const reactions: Any[] = [{ task_id: report.id, occ_date: T, user_id: 'u3', emoji: '👏' }];
const kinds: Any[] = [
  { id: 'k1', group_id: 'gw', name: '営業訪問' },
  { id: 'k2', group_id: 'gf', name: '通院' },
];

const checklists: Any[] = [
  { id: 'c1', name: '家を出る時', trigger: 'time', show_at: '07:00', weekdays: [1, 2, 3, 4, 5], position: 0, items: ['財布', 'スマホ', '鍵', '社員証', '傘（天気を確認）', 'ゴミ'] },
  { id: 'c2', name: 'お店を出る時', trigger: 'manual', show_at: null, weekdays: [0, 1, 2, 3, 4, 5, 6], position: 1, items: ['傘', '買った物', 'レシート'] },
  { id: 'c3', name: 'キャンプ出発前', trigger: 'manual', show_at: null, weekdays: [0, 1, 2, 3, 4, 5, 6], position: 2, items: ['テント・ペグ', '寝袋', 'ランタン', '火ばさみ', 'クーラーボックス', '雨具'] },
].map(c => ({ ...c, items: c.items.map((label: string) => ({ id: id(), label })) }));
const checks = new Set<string>(); // itemId|day

const notifications: Any[] = [
  { id: 2, user_id: 'me', kind: 'created', actor_id: 'u3', task_id: review.id, occ_date: null, body: '佐藤次郎さんが「企画書レビュー」を設定しました', created_at: ago(5), read_at: null },
  { id: 3, user_id: 'me', kind: 'done', actor_id: 'u2', task_id: report.id, occ_date: T, body: '鈴木花子さんが「資料作成」を完了しました！', created_at: ago(2), read_at: null },
];
let nseq = 10;
let loggedIn = true;
let reviewSkip = false;

class DemoError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const fail = (m: string, status = 400): never => { throw new DemoError(status, m); };

function notifyOthers(groupId: string, kind: string, taskId: string, body: string, occ: string | null = null) {
  const g = groups.find(x => x.id === groupId);
  if (!g || g.is_personal) return;
  if ((kind === 'created' && !g.notify_create) || (kind === 'done' && !g.notify_done)) return;
  // デモでは「他のメンバー」側の画面はないので、記録だけ残す
}

function setDone(t: Any, day: string | null, isDone: boolean) {
  if (t.repeat) {
    const i = done.findIndex(d => d.task_id === t.id && d.occ_date === day);
    if (isDone && i < 0) done.push({ task_id: t.id, occ_date: day, user_id: 'me', done_at: new Date().toISOString() });
    if (!isDone && i >= 0) done.splice(i, 1);
  } else {
    t.done_at = isDone ? new Date().toISOString() : null;
    t.done_by = isDone ? 'me' : null;
  }
  if (isDone) notifyOthers(t.group_id, 'done', t.id, '');
}

function pick(b: Any, keys: string[]) {
  const o: Any = {};
  for (const k of keys) if (k in b) o[k] = b[k];
  return o;
}
const assigneesFrom = (groupId: string, raw: unknown) =>
  groupId === 'gp' || raw === 'all' || raw === null ? null : Array.isArray(raw) && raw.length ? raw : ['me'];
const followups: Any[] = [];
const TASK_KEYS = ['title', 'description', 'kind', 'kind_id', 'starred', 'color', 'date', 'time', 'duration_min', 'reminders', 'remind_all', 'repeat', 'group_id'];

function state(day: string | null) {
  if (!loggedIn) return { me: null };
  const myGroups = groups.filter(g => g.m.includes('me'));
  const gids = new Set(myGroups.map(g => g.id));
  const vis = tasks.filter(t => gids.has(t.group_id) && (t.status === 'ready' || t.user_id === 'me'));
  const ids = new Set(vis.map(t => t.id));
  const d = day || today();
  return {
    me: { id: 'me', name: users.me, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, review_skip: reviewSkip },
    groups: myGroups.map(({ m, ...g }) => ({ ...g, members: m.map((u: string) => ({ id: u, name: users[u] })) })),
    tasks: vis.map(t => ({ ...t })),
    done: done.filter(x => ids.has(x.task_id)).map(x => ({ ...x })),
    items: items.filter(i => ids.has(i.task_id)).sort((a, b) => a.position - b.position).map(i => ({ ...i })),
    reactions: reactions.filter(r => ids.has(r.task_id)),
    followups: followups.filter(f => ids.has(f.task_id)),
    kinds: kinds.filter(k => gids.has(k.group_id)),
    checklists: checklists.map(c => ({ ...c, items: c.items.map((i: Any) => ({ ...i, checked: checks.has(i.id + '|' + d) })) })),
    notifications: notifications.filter(n => n.user_id === 'me').sort((a, b) => b.id - a.id).map(n => ({ ...n, actor: n.actor_id ? users[n.actor_id] : null })),
    pushKey: null,
  };
}

const findTask = (tid: string) => tasks.find(t => t.id === tid) || fail('見つかりません', 404);

async function handle(path: string, method: string, b: Any): Promise<any> {
  const [p, qs] = path.split('?');
  const seg = p.split('/');
  const M = method;
  if (p === 'state') return state(new URLSearchParams(qs || '').get('day'));
  if (p === 'auth/register' && M === 'POST') { if (!b.name?.trim()) fail('ユーザー名を入力してください'); users.me = b.name.trim(); loggedIn = true; return { ok: true }; }
  if (p === 'auth/link' && M === 'POST') { if (String(b.code).length !== 6) fail('コードが違うか、期限（10分）が切れています'); loggedIn = true; return { ok: true }; }
  if (p === 'auth/link-code') return { code: String(Math.floor(100000 + Math.random() * 899999)), expiresInSec: 600 };
  if (p === 'auth/logout') { loggedIn = false; return { ok: true }; }
  if (p === 'devices') return [{ device: 'iPhone', created_at: ago(9000), last_used_at: ago(3) }, { device: 'Windows PC（会社）', created_at: ago(8000), last_used_at: ago(60) }];
  if (p === 'me') { if ('review_skip' in b) reviewSkip = !!b.review_skip; return { ok: true }; }

  if (p === 'tasks' && M === 'POST') {
    if (b.quick) { const t = task({ status: 'draft', title: (b.title || '').slice(0, 120), description: String(b.description || ''), captured_at: new Date().toISOString(), detailed_at: null, reminders: [] }); tasks.push(t); return { id: t.id }; }
    if (!b.title?.trim()) fail('タイトルを入力してください');
    const gid = b.group_id || 'gp';
    const t = task({ ...pick(b, TASK_KEYS), group_id: gid, assignees: assigneesFrom(gid, 'assignees' in b ? b.assignees : ['me']), detailed_at: new Date().toISOString(), captured_at: new Date().toISOString() });
    tasks.push(t);
    (b.items || []).forEach((label: string, i: number) => items.push({ id: id(), task_id: t.id, label, checked: false, position: i }));
    notifyOthers(t.group_id, 'created', t.id, '');
    return { id: t.id };
  }
  if (seg[0] === 'tasks' && seg.length === 2) {
    const t = findTask(seg[1]);
    if (M === 'DELETE') { tasks.splice(tasks.indexOf(t), 1); return { ok: true }; }
    if (M === 'PATCH') {
      if (t.status === 'draft' && b.status === 'ready') { if (!(b.title ?? t.title)) fail('タイトルを入力してください'); t.status = 'ready'; t.detailed_at = new Date().toISOString(); }
      Object.assign(t, pick(b, TASK_KEYS), { updated_at: new Date().toISOString() });
      if ('assignees' in b || 'group_id' in b) t.assignees = assigneesFrom(t.group_id, 'assignees' in b ? b.assignees : t.assignees);
      if (!t.time) t.reminders = [];
      return { ok: true };
    }
  }
  // 繰り返しの予定の「この日だけ／この日以降」（サーバーの tasks/:id/split と同じ動き）
  if (seg[0] === 'tasks' && seg[2] === 'split') {
    const t = findTask(seg[1]);
    const day = b.day, scope = b.scope;
    const except: string[] = t.repeat.except || [];
    if (scope === 'following' && day === t.date) {
      if (b.delete) tasks.splice(tasks.indexOf(t), 1);
      else Object.assign(t, pick(b, TASK_KEYS), { updated_at: new Date().toISOString() });
      return { ok: true };
    }
    const prev = addDays(day, -1);
    const oldRepeat = { ...t.repeat };
    t.repeat = scope === 'one' ? { ...oldRepeat, except: [...new Set([...except, day])].sort() } : { ...oldRepeat, until: prev, except: except.filter(d => d < day) };
    const inRange = (d: string) => (scope === 'one' ? d === day : d >= day);
    if (b.delete) {
      for (let i = done.length - 1; i >= 0; i--) if (done[i].task_id === t.id && inRange(done[i].occ_date)) done.splice(i, 1);
      return { ok: true };
    }
    const n = task({ ...t, id: id(), ...pick(b, TASK_KEYS), date: b.date || day, repeat: scope === 'one' ? null : { ...(b.repeat || oldRepeat), except: except.filter(d => d >= day) }, done_at: null, done_by: null });
    tasks.push(n);
    for (let i = done.length - 1; i >= 0; i--) {
      const d = done[i];
      if (d.task_id !== t.id || !inRange(d.occ_date)) continue;
      if (scope === 'one') { n.done_at = d.done_at || new Date().toISOString(); n.done_by = d.user_id; done.splice(i, 1); } else d.task_id = n.id;
    }
    reactions.forEach(r => { if (r.task_id === t.id && inRange(r.occ_date)) r.task_id = n.id; });
    return { ok: true, id: n.id };
  }
  if (seg[0] === 'tasks' && seg[2] === 'done') { const t = findTask(seg[1]); setDone(t, b.day, b.done !== false); return { ok: true }; }
  if (seg[0] === 'tasks' && seg[2] === 'items' && !seg[3]) {
    const t = findTask(seg[1]);
    const labels = (b.labels || [b.label]).filter(Boolean);
    const max = Math.max(-1, ...items.filter(i => i.task_id === t.id).map(i => i.position));
    labels.forEach((label: string, i: number) => items.push({ id: id(), task_id: t.id, label, checked: false, position: max + 1 + i }));
    t.done_at = null;
    return { ok: true };
  }
  if (seg[0] === 'tasks' && seg[2] === 'items' && seg[3] === 'clear-checked') {
    const t = findTask(seg[1]);
    for (let i = items.length - 1; i >= 0; i--) if (items[i].task_id === t.id && items[i].checked) items.splice(i, 1);
    return { ok: true };
  }
  if (seg[0] === 'items') {
    const it = items.find(i => i.id === seg[1]) || fail('見つかりません', 404);
    if (M === 'DELETE') { items.splice(items.indexOf(it), 1); return { ok: true }; }
    if ('label' in b) it.label = b.label;
    let completed = false;
    if ('checked' in b) {
      it.checked = !!b.checked;
      it.checked_by = b.checked ? 'me' : null;
      const t = findTask(it.task_id);
      const left = items.filter(i => i.task_id === t.id && !i.checked).length;
      if (left === 0 && !t.done_at) { setDone(t, null, true); completed = true; } else if (left > 0) t.done_at = null;
    }
    return { ok: true, completed };
  }
  if (p === 'reactions') {
    reactions.push({ task_id: b.task_id, occ_date: b.occ_date || today(), user_id: 'me', emoji: b.emoji });
    return { ok: true };
  }
  if (p === 'groups' && M === 'POST') {
    if (!b.name?.trim()) fail('グループ名を入力してください');
    const g = { id: id(), name: b.name.trim(), description: '', color: b.color || '#2BA0FF', is_personal: false, owner_id: 'me', notify_create: true, notify_done: true, invite_token: 'demo-' + seq, m: ['me'] };
    groups.push(g);
    return { id: g.id };
  }
  if (seg[0] === 'groups' && seg.length === 2 && M === 'PATCH') { Object.assign(groups.find(g => g.id === seg[1]) || fail('見つかりません', 404), pick(b, ['name', 'description', 'color', 'notify_create', 'notify_done'])); return { ok: true }; }
  if (seg[0] === 'groups' && seg[2] === 'leave') { const g = groups.find(x => x.id === seg[1]) || fail('見つかりません', 404); g.m = g.m.filter((u: string) => u !== 'me'); return { ok: true }; }
  if (seg[0] === 'groups' && seg[2] === 'kinds' && M === 'POST') {
    const name = String(b.name || '').trim();
    if (!name) fail('種類の名前を入力してください');
    if (kinds.some(k => k.group_id === seg[1] && k.name.toLowerCase() === name.toLowerCase())) fail(`「${name}」はもうこのグループにあります`);
    const k = { id: id(), group_id: seg[1], name };
    kinds.push(k);
    return { id: k.id };
  }
  if (seg[0] === 'kinds' && M === 'DELETE') {
    const i = kinds.findIndex(k => k.id === seg[1]);
    if (i >= 0) { tasks.forEach(t => { if (t.kind_id === seg[1]) t.kind_id = null; }); kinds.splice(i, 1); }
    return { ok: true };
  }
  if (seg[0] === 'invite') fail('デモでは招待リンクは使えません', 404);

  if (p === 'checklists' && M === 'POST') {
    const c = { id: id(), name: b.name, trigger: b.trigger, show_at: b.show_at, weekdays: b.weekdays, position: checklists.length, items: (b.items || []).map((i: Any) => ({ id: id(), label: i.label })) };
    checklists.push(c);
    return { id: c.id };
  }
  if (seg[0] === 'checklists' && seg.length === 2) {
    const c = checklists.find(x => x.id === seg[1]) || fail('見つかりません', 404);
    if (M === 'DELETE') { checklists.splice(checklists.indexOf(c), 1); return { ok: true }; }
    Object.assign(c, pick(b, ['name', 'trigger', 'show_at', 'weekdays']));
    if (b.items) c.items = b.items.map((i: Any) => ({ id: i.id || id(), label: i.label }));
    return { ok: true };
  }
  if (seg[0] === 'checklist-items') {
    const k = seg[1] + '|' + (b.day || today());
    if (b.checked) checks.add(k); else checks.delete(k);
    return { ok: true };
  }
  if (p === 'notifications/read') {
    for (const n of notifications) if (!b.ids || b.ids.includes(n.id)) n.read_at = n.read_at || new Date().toISOString();
    return { ok: true };
  }
  if (seg[0] === 'tasks' && seg[2] === 'followup') {
    const t = findTask(seg[1]);
    const day = b.day || today();
    const i = followups.findIndex(f => f.task_id === t.id && f.occ_date === day);
    const cur = i >= 0 ? followups[i] : null;
    if (i >= 0) followups.splice(i, 1);
    if (b.action === 'later') followups.push({ task_id: t.id, occ_date: day, state: 'snoozed', snooze_count: (cur?.snooze_count || 0) + 1, next_at: new Date(Date.now() + 15 * 60000).toISOString() });
    if (b.action === 'hold') followups.push({ task_id: t.id, occ_date: day, state: 'held', snooze_count: cur?.snooze_count || 0, next_at: null });
    return { ok: true };
  }
  if (p.startsWith('push/')) return { ok: true, sent: 0 };
  fail('not found', 404);
}

// しばらくすると、メンバーの動きが届く（付箋の体験用）
setTimeout(() => {
  const t = tasks.find(x => x.title === '見積書を送る');
  if (!t) return;
  t.done_at = new Date().toISOString(); t.done_by = 'u2';
  notifications.push({ id: nseq++, user_id: 'me', kind: 'done', actor_id: 'u2', task_id: t.id, occ_date: t.date, body: '鈴木花子さんが「見積書を送る」を完了しました！', created_at: new Date().toISOString(), read_at: null });
}, 40000);
setTimeout(() => {
  const t = task({ group_id: 'gf', user_id: 'u4', title: '夕飯は外で食べる', date: T, time: '19:00', duration_min: 90 });
  tasks.push(t);
  notifications.push({ id: nseq++, user_id: 'me', kind: 'created', actor_id: 'u4', task_id: t.id, occ_date: null, body: '母さんが「夕飯は外で食べる」を設定しました', created_at: new Date().toISOString(), read_at: null });
}, 80000);

export async function demoApi(path: string, method = 'GET', body?: unknown) {
  await new Promise(r => setTimeout(r, 60)); // 通信しているような小さな間
  try {
    return JSON.parse(JSON.stringify(await handle(path, method, (body as Any) || {})));
  } catch (e: any) {
    throw new ApiError(e.status || 500, e.message);
  }
}
