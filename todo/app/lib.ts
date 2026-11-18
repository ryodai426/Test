'use client';
import { occursOn, titleOr, type Repeat } from '@/lib/time';

export type Member = { id: string; name: string };
export type Group = {
  id: string; name: string; description: string; color: string; is_personal: boolean; owner_id: string;
  notify_create: boolean; notify_done: boolean; invite_token: string | null; members: Member[];
};
export type Task = {
  id: string; user_id: string; group_id: string; status: 'draft' | 'ready'; title: string; description: string;
  kind: string; kind_id: string | null; assignees: string[] | null; starred: boolean; color: string | null; date: string | null; end_date?: string | null; time: string | null; duration_min: number;
  reminders: string[]; remind_all: boolean; repeat: Repeat | null; captured_at: string; detailed_at: string | null;
  done_at: string | null; done_by: string | null; updated_at: string;
};
export type Kind = { id: string; group_id: string; name: string };
export type Followup = { task_id: string; occ_date: string; state: 'snoozed' | 'held'; next_at: string | null; snooze_count: number };
export type Item = { id: string; task_id: string; label: string; checked: boolean; position: number; checked_by?: string | null };
export type Checklist = {
  id: string; name: string; trigger: 'time' | 'after_shopping' | 'manual'; show_at: string | null; weekdays: number[];
  position: number; items: { id: string; label: string; checked: boolean }[];
};
export type Notice = { id: number; kind: string; task_id: string | null; occ_date: string | null; body: string; created_at: string; read_at: string | null; actor: string | null };
export type State = {
  me: { id: string; name: string; tz: string; review_skip?: boolean } | null;
  groups: Group[]; tasks: Task[]; done: { task_id: string; occ_date: string; user_id: string; done_at?: string }[];
  items: Item[]; reactions: { task_id: string; occ_date: string; user_id: string; emoji: string }[];
  checklists: Checklist[]; notifications: Notice[]; pushKey: string | null;
  kinds: Kind[];
  followups: Followup[];
  build?: string; // サーバーの版（画面の版と違えば、画面が古い）
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Service Worker（使えない環境では undefined。埋め込み表示などでアクセス自体が例外になることがある） */
export function sw(): ServiceWorkerContainer | undefined {
  try { return 'serviceWorker' in navigator ? navigator.serviceWorker : undefined; } catch { return undefined; }
}

/** デモ版（サーバーなし）のときは、ブラウザ内の擬似サーバーに差し替える */
export const isDemo = () => typeof globalThis !== 'undefined' && !!(globalThis as any).__DEMO_API__;

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const demo = (globalThis as any).__DEMO_API__;
  if (demo) return demo(path, method, body);
  const res = await fetch('/api/' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || '通信に失敗しました');
  return data as T;
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function localNowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const localDateOf = (iso: string) => new Date(iso).toLocaleDateString('sv-SE');

export function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtJpDate(s: string, withWeek = true): string {
  const [y, m, d] = s.split('-').map(Number);
  const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}${withWeek ? `（${w}）` : ''}`;
}

export type Occ = { task: Task; day: string; done: boolean; color: string; group: Group | undefined };

/**
 * その予定が、who さんのカレンダーに出るか。
 * 個人グループの予定 → 持ち主（自分）だけ。グループの予定 → 「共通」か、表示する人に選ばれていれば
 */
export function isFor(t: Task, who: string, s: State): boolean {
  const g = s.groups.find(x => x.id === t.group_id);
  if (!g || g.is_personal) return who === s.me?.id;
  return !t.assignees || t.assignees.includes(who);
}

/** 画面に出す予定の名前（タイトルが空なら種類の名前） */
export function titleOf(t: Pick<Task, 'title' | 'kind' | 'kind_id'>, s: State): string {
  return titleOr(t, t.kind_id ? (s.kinds || []).find(k => k.id === t.kind_id)?.name : null);
}

/** その日の予定。who を省略したら自分の予定 */
export function occurrences(s: State, day: string, groupFilter: string, who?: string): Occ[] {
  const groups = new Map(s.groups.map(g => [g.id, g]));
  const doneSet = new Set(s.done.map(d => d.task_id + '|' + d.occ_date));
  const person = who || s.me?.id || '';
  return s.tasks
    .filter(t => t.status === 'ready' && (groupFilter === 'all' || t.group_id === groupFilter) && isFor(t, person, s) && occursOn(t, day))
    .map(t => {
      const g = groups.get(t.group_id);
      return { task: t, day, group: g, color: taskColor(t, s), done: t.repeat ? doneSet.has(t.id + '|' + day) : !!t.done_at };
    })
    .sort((a, b) => (a.task.time || '').localeCompare(b.task.time || ''));
}

/** 重要な順：星付き → 設定した時間が長い順 → 時刻のない予定（月表示で上から3件に使う） */
export function byImportance(a: Occ, b: Occ): number {
  if (a.task.starred !== b.task.starred) return a.task.starred ? -1 : 1;
  const da = a.task.time ? a.task.duration_min : -1;
  const db = b.task.time ? b.task.duration_min : -1;
  if (da !== db) return db - da;
  return (a.task.time || '99').localeCompare(b.task.time || '99');
}

/** 「完了しましたか？」を聞く相手か：表示する人／共通なら作った人／個人グループなら持ち主 */
export function asksMe(t: Task, s: State): boolean {
  const me = s.me?.id;
  const g = s.groups.find(x => x.id === t.group_id);
  if (!g || g.is_personal) return t.user_id === me;
  return t.assignees?.length ? t.assignees.includes(me || '') : t.user_id === me;
}

export function followupOf(s: State, taskId: string, day: string): Followup | undefined {
  return (s.followups || []).find(f => f.task_id === taskId && f.occ_date === day);
}

// ---- 予定の色 ------------------------------------------------------------------
// 個人の予定は黄色で固定。グループの予定は「表示する人」で決める：共通＝グループの色、メンバー＝それぞれの色。
// 予定の入力画面で色は選ばない（前に選んだ色 tasks.color は使わない）。グループの色はメンバー・共有設定で選ぶ
export const PERSONAL_COLOR = '#F5E211';
export const COMMON_COLOR = '#8ED462'; // グループの色が分からないときの共通の色
/** グループとメンバーに使う色（黄色を除いた11色）。メンバーには、グループの色と重ならないように割り当てる（memberColor） */
export const COLOR_POOL = ['#8ED462', '#2BA0FF', '#FF705D', '#A77BEA', '#FF9F43', '#A0522D', '#9AA0A6', '#17B5A6', '#34508F', '#F06292', '#EBC1FF'];
export const GROUP_COLORS = COLOR_POOL;
export const MEMBER_COLORS = COLOR_POOL; // 互換のため

/** グループの色（左のメニューの点・共通の予定の色）。個人は黄色。前に黄色を選んでいた共有グループは青 */
export function groupColor(g: Pick<Group, 'is_personal' | 'color'> | undefined): string {
  if (!g) return COMMON_COLOR;
  if (g.is_personal) return PERSONAL_COLOR;
  const c = (g.color || '').toUpperCase();
  return !c || c === PERSONAL_COLOR ? '#2BA0FF' : g.color;
}

/**
 * そのグループで、その人の色。グループに入った順に、青・コーラル・紫…（COLOR_POOL の2番目から）を割り当てる。
 * その色がグループの色と同じ人だけ、緑（グループが緑なら紫）に替える。グループの色を変えても、ほかの人の色は変わらない
 */
export function memberColor(g: Group | undefined, userId: string): string {
  const i = g ? g.members.findIndex(m => m.id === userId) : -1;
  if (i < 0) return '#9AA0A6';
  const own = groupColor(g).toUpperCase();
  const c = COLOR_POOL[1 + (i % (COLOR_POOL.length - 1))];
  if (c !== own) return c;
  return own === COLOR_POOL[0] ? COLOR_POOL[3] : COLOR_POOL[0];
}

/** 予定の色：個人＝黄、グループの共通＝グループの色、表示する人を選んだ予定＝その人の色（複数なら、グループに先に入った人） */
export function taskColor(t: Pick<Task, 'group_id' | 'assignees'>, s: State): string {
  const g = s.groups.find(x => x.id === t.group_id);
  if (!g || g.is_personal) return PERSONAL_COLOR;
  if (!t.assignees?.length) return groupColor(g);
  const first = g.members.find(m => t.assignees!.includes(m.id));
  return first ? memberColor(g, first.id) : groupColor(g);
}
