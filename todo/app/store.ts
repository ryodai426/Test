'use client';
// 押した瞬間に画面を書き換え、サーバーへの送信と最新データの取り直しは裏で行うための仕組み。
// （以前は「送信 → 全部のデータを取り直す → やっと画面が変わる」だったので、押してから反映まで待たされていた）
import type { Checklist, Item, State, Task } from './lib';

type Patch = (s: State) => State;

let setter: ((fn: Patch) => void) | null = null;
let refresher: (() => void) | null = null;
let failer: ((e: unknown) => void) | null = null;
/** 最後に画面を書き換えた時刻。これより前に始めた取り直しの結果は捨てる（古いデータで巻き戻さない） */
let lastLocalChange = 0;
export const changedSince = (t: number) => lastLocalChange > t;

export function bindStore(set: (fn: Patch) => void, refresh: () => void, fail: (e: unknown) => void) {
  setter = set; refresher = refresh; failer = fail;
}

export function patch(fn: Patch) {
  lastLocalChange = Date.now();
  setter?.(fn);
}

export function refreshSoon() { refresher?.(); }

/** 画面を先に変えて、裏で送る。失敗したら最新のデータに戻す */
export async function act<T>(fn: Patch | null, req: () => Promise<T>): Promise<T | undefined> {
  if (fn) patch(fn);
  try {
    const r = await req();
    lastLocalChange = Date.now();
    refreshSoon();
    return r;
  } catch (e) {
    failer?.(e);
    refreshSoon();
    return undefined;
  }
}

let tmpSeq = 0;
export const tmpId = () => `tmp-${Date.now()}-${tmpSeq++}`;
export const isTmp = (id: string) => id.startsWith('tmp-');

// ---------------------------------------------------------------- 画面の書き換え（純粋な関数）

export const P = {
  setDone: (taskId: string, day: string, done: boolean, me: string): Patch => s => {
    const t = s.tasks.find(x => x.id === taskId);
    if (!t) return s;
    if (t.repeat) {
      const rest = s.done.filter(d => !(d.task_id === taskId && d.occ_date === day));
      return { ...s, done: done ? [...rest, { task_id: taskId, occ_date: day, user_id: me, done_at: new Date().toISOString() }] : rest };
    }
    return { ...s, tasks: s.tasks.map(x => (x.id === taskId ? { ...x, done_at: done ? new Date().toISOString() : null, done_by: done ? me : null } : x)) };
  },
  removeTask: (taskId: string): Patch => s => ({ ...s, tasks: s.tasks.filter(t => t.id !== taskId), items: s.items.filter(i => i.task_id !== taskId) }),
  updateTask: (taskId: string, fields: Partial<Task>): Patch => s => ({ ...s, tasks: s.tasks.map(t => (t.id === taskId ? { ...t, ...fields, updated_at: new Date().toISOString() } : t)) }),
  addTask: (t: Task, items: string[] = []): Patch => s => ({
    ...s, tasks: [...s.tasks, t],
    items: [...s.items, ...items.map((label, i) => ({ id: tmpId(), task_id: t.id, label, checked: false, position: i }))],
  }),
  setItem: (itemId: string, checked: boolean, me: string): Patch => s => {
    const items = s.items.map(i => (i.id === itemId ? { ...i, checked, checked_by: checked ? me : null } : i));
    const it = items.find(i => i.id === itemId);
    if (!it) return s;
    // 全部チェックしたら、買い物リストは完了
    const all = items.filter(i => i.task_id === it.task_id);
    const allDone = all.length > 0 && all.every(i => i.checked);
    const tasks = s.tasks.map(t => (t.id === it.task_id && !t.repeat
      ? { ...t, done_at: allDone ? t.done_at || new Date().toISOString() : null, done_by: allDone ? t.done_by || me : null } : t));
    return { ...s, items, tasks };
  },
  addItems: (taskId: string, labels: string[]): Patch => s => {
    const max = Math.max(-1, ...s.items.filter(i => i.task_id === taskId).map(i => i.position));
    const add: Item[] = labels.map((label, i) => ({ id: tmpId(), task_id: taskId, label, checked: false, position: max + 1 + i }));
    return { ...s, items: [...s.items, ...add], tasks: s.tasks.map(t => (t.id === taskId ? { ...t, done_at: null, done_by: null } : t)) };
  },
  removeItem: (itemId: string): Patch => s => ({ ...s, items: s.items.filter(i => i.id !== itemId) }),
  clearChecked: (taskId: string): Patch => s => ({ ...s, items: s.items.filter(i => !(i.task_id === taskId && i.checked)) }),
  setCheck: (itemId: string, checked: boolean): Patch => s => ({
    ...s, checklists: s.checklists.map(c => ({ ...c, items: c.items.map(i => (i.id === itemId ? { ...i, checked } : i)) })),
  }),
  removeChecklist: (id: string): Patch => s => ({ ...s, checklists: s.checklists.filter(c => c.id !== id) }),
  upsertChecklist: (c: Checklist): Patch => s => ({
    ...s, checklists: s.checklists.some(x => x.id === c.id) ? s.checklists.map(x => (x.id === c.id ? c : x)) : [...s.checklists, c],
  }),
  addReaction: (taskId: string, day: string, me: string, emoji: string): Patch => s => ({
    ...s, reactions: [...s.reactions, { task_id: taskId, occ_date: day, user_id: me, emoji }],
  }),
  setFollowup: (taskId: string, day: string, state: 'snoozed' | 'held'): Patch => s => ({
    ...s, followups: [...(s.followups || []).filter(f => !(f.task_id === taskId && f.occ_date === day)),
      { task_id: taskId, occ_date: day, state, next_at: state === 'snoozed' ? new Date(Date.now() + 15 * 60000).toISOString() : null, snooze_count: 0 }],
  }),
};

/** 新しく作る予定・メモを、送信前に画面へ出すための仮のタスク */
export function draftTask(s: State, fields: Partial<Task>): Task {
  const now = new Date().toISOString();
  return {
    id: tmpId(), user_id: s.me!.id, group_id: s.groups.find(g => g.is_personal)!.id, status: 'ready', title: '', description: '',
    kind: 'general', kind_id: null, assignees: null, starred: false, color: null, date: null, time: null, duration_min: 60,
    reminders: [], remind_all: false, repeat: null, captured_at: now, detailed_at: now, done_at: null, done_by: null, updated_at: now,
    ...fields,
  };
}
