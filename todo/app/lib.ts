'use client';
import { occursOn, type Repeat } from '@/lib/time';

export type Member = { id: string; name: string };
export type Group = {
  id: string; name: string; description: string; color: string; is_personal: boolean; owner_id: string;
  notify_create: boolean; notify_done: boolean; invite_token: string | null; members: Member[];
};
export type Task = {
  id: string; user_id: string; group_id: string; status: 'draft' | 'ready'; title: string; description: string;
  kind: string; color: string | null; date: string | null; time: string | null; duration_min: number;
  reminders: string[]; remind_all: boolean; repeat: Repeat | null; captured_at: string; detailed_at: string | null;
  done_at: string | null; done_by: string | null; updated_at: string;
};
export type Item = { id: string; task_id: string; label: string; checked: boolean; position: number };
export type Checklist = {
  id: string; name: string; trigger: 'time' | 'after_shopping' | 'manual'; show_at: string | null; weekdays: number[];
  position: number; items: { id: string; label: string; checked: boolean }[];
};
export type Notice = { id: number; kind: string; task_id: string | null; occ_date: string | null; body: string; created_at: string; read_at: string | null; actor: string | null };
export type State = {
  me: { id: string; name: string; tz: string } | null;
  groups: Group[]; tasks: Task[]; done: { task_id: string; occ_date: string; user_id: string }[];
  items: Item[]; reactions: { task_id: string; occ_date: string; user_id: string; emoji: string }[];
  checklists: Checklist[]; notifications: Notice[]; pushKey: string | null;
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

export function occurrences(s: State, day: string, groupFilter: string): Occ[] {
  const groups = new Map(s.groups.map(g => [g.id, g]));
  const doneSet = new Set(s.done.map(d => d.task_id + '|' + d.occ_date));
  return s.tasks
    .filter(t => t.status === 'ready' && (groupFilter === 'all' || t.group_id === groupFilter) && occursOn(t, day))
    .map(t => {
      const g = groups.get(t.group_id);
      return { task: t, day, group: g, color: t.color || g?.color || '#6B7280', done: t.repeat ? doneSet.has(t.id + '|' + day) : !!t.done_at };
    })
    .sort((a, b) => (a.task.time || '').localeCompare(b.task.time || ''));
}

// 草原・空・焚き火・太陽・花…明るいアウトドアの色
export const PALETTE = ['#5DB33C', '#2E9BFF', '#FF7461', '#E8C21E', '#B47BE0', '#F28BB5', '#22B0A0', '#A0703F'];
