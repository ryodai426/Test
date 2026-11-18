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
