'use client';
import { useEffect, useState } from 'react';
import { occurrences, toMin, type Group, type State } from '../lib';

// アイコンの色（文字が読める明るい色だけ）
const AVATAR_COLORS = ['#8ED462', '#2BA0FF', '#FF705D', '#F5E211', '#EBC1FF', '#FFBE9F'];

export function avatarColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function Avatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: avatarColor(id), fontSize: size * 0.42 }} aria-hidden="true">
      {[...name.trim()][0] || '?'}
    </span>
  );
}

function useNowMin() {
  const [m, setM] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  useEffect(() => {
    const id = setInterval(() => { const d = new Date(); setM(d.getHours() * 60 + d.getMinutes()); }, 30000);
    return () => clearInterval(id);
  }, []);
  return m;
}

/** その人が今やっている予定（なければ、今日このあとの予定） */
function statusOf(state: State, group: Group, memberId: string, today: string, now: number): { kind: 'now' | 'next' | 'free'; text: string } {
  const list = occurrences(state, today, group.id, memberId).filter(o => o.task.time && !o.done);
  for (const o of list) {
    const s = toMin(o.task.time!);
    const e = s + Math.max(20, o.task.duration_min);
    if (now >= s && now < e) {
      const end = `${String(Math.floor(e / 60) % 24).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
      return { kind: 'now', text: `${o.task.title} 〜${end}` };
    }
  }
  const next = list.find(o => toMin(o.task.time!) > now);
  if (next) return { kind: 'next', text: `次 ${next.task.time} ${next.task.title}` };
  return { kind: 'free', text: '空き' };
}

/**
 * グループを選んだときに上に並ぶ、メンバーのアイコン。
 * 押すとその人の予定に切り替わる。アイコンの下に「今やっていること」を出す。
 */
export default function MemberStrip({ state, group, who, today, onPick }: {
  state: State; group: Group; who: string; today: string; onPick: (id: string) => void;
}) {
  const now = useNowMin();
  const me = state.me!.id;
  const members = [...group.members].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
  return (
    <div className="member-strip" role="tablist" aria-label={`${group.name}のメンバー`}>
      {members.map(m => {
        const st = statusOf(state, group, m.id, today, now);
        const on = who === m.id;
        return (
          <button key={m.id} role="tab" aria-selected={on} className={'member' + (on ? ' on' : '')} onClick={() => onPick(m.id)}>
            <span className="member-av">
              <Avatar id={m.id} name={m.name} size={42} />
              <span className={'member-dot ' + st.kind} />
            </span>
            <span className="member-name">{m.id === me ? '自分' : m.name}</span>
            <span className={'member-st ' + st.kind}>{st.text}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * メンバーのアイコンを押したときに出る、その人の仕事の詳細。
 * 今やっていること（時間・残り時間・説明）、次の予定、今日の進み具合。
 */
export function MemberFocus({ state, group, who, today, onOpenTask }: {
  state: State; group: Group; who: string; today: string; onOpenTask: (taskId: string, day: string) => void;
}) {
  const now = useNowMin();
  const m = group.members.find(x => x.id === who);
  if (!m) return null;
  const list = occurrences(state, today, group.id, who);
  const timed = list.filter(o => o.task.time);
  const span = (o: (typeof list)[number]) => { const s = toMin(o.task.time!); return { s, e: s + Math.max(20, o.task.duration_min) }; };
  const cur = timed.find(o => !o.done && now >= span(o).s && now < span(o).e);
  const next = timed.find(o => !o.done && span(o).s > now);
  const done = list.filter(o => o.done).length;
  const hm = (x: number) => `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  return (
    <div className="member-focus">
      <div className="mf-head">
        <Avatar id={m.id} name={m.name} size={34} />
        <div className="grow"><b>{m.name}さん</b><span className="mf-progress">今日 {done}/{list.length} 完了</span></div>
        <div className="mf-bar" aria-hidden="true"><span style={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} /></div>
      </div>
      {cur ? (
        <button className="mf-now" onClick={() => onOpenTask(cur.task.id, today)} style={{ ['--c' as string]: cur.color }}>
          <span className="mf-label now">いまやっていること</span>
          <span className="mf-title">{cur.task.starred && <span className="star-mark">★</span>}{cur.task.title}</span>
          <span className="mf-meta">{hm(span(cur).s)}–{hm(span(cur).e)}・あと{span(cur).e - now}分{cur.task.description ? '' : ''}</span>
          {cur.task.description && <span className="mf-desc">{cur.task.description}</span>}
        </button>
      ) : (
        <div className="mf-now free"><span className="mf-label">いまは</span><span className="mf-title">空いています</span></div>
      )}
      {next && (
        <button className="mf-next" onClick={() => onOpenTask(next.task.id, today)}>
          <span className="mf-label">次</span>{next.task.time} {next.task.title}<span className="mf-meta">あと{span(next).s - now}分</span>
        </button>
      )}
    </div>
  );
}
