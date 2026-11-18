'use client';
import { useEffect, useState } from 'react';
import { memberColor, occurrences, toMin, type Group, type State } from '../lib';
import Icon from './Icon';
import { titleOr } from '@/lib/time';

// アイコンの色（文字が読める明るい色だけ）
const AVATAR_COLORS = ['#8ED462', '#2BA0FF', '#FF705D', '#F5E211', '#EBC1FF', '#FFBE9F'];

export function avatarColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function Avatar({ id, name, size = 40, color }: { id: string; name: string; size?: number; color?: string }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: color || avatarColor(id), fontSize: size * 0.42 }} aria-hidden="true">
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
      return { kind: 'now', text: `${titleOr(o.task)} 〜${end}` };
    }
  }
  const next = list.find(o => toMin(o.task.time!) > now);
  if (next) return { kind: 'next', text: `次 ${next.task.time} ${titleOr(next.task)}` };
  return { kind: 'free', text: '空き' };
}

/**
 * 上のバー（グループ名の横）に並ぶ、メンバーのアイコンと状態の点だけ（何をしているかは出さない）。
 * 押すと、その人の予定に切り替わり、仕事の詳細（MemberFocus）が開く。点の色：コーラル＝予定中、黄＝このあと予定、緑＝空き
 */
export default function MemberDots({ state, group, who, today, onPick }: {
  state: State; group: Group; who: string; today: string; onPick: (id: string) => void;
}) {
  const now = useNowMin();
  const me = state.me!.id;
  const members = [...group.members].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
  const word = { now: '予定中', next: 'このあと予定', free: '空き' };
  return (
    <div className="member-dots" role="tablist" aria-label={`${group.name}のメンバー`}>
      {members.map(m => {
        const st = statusOf(state, group, m.id, today, now);
        const on = who === m.id && m.id !== me;
        const name = m.id === me ? '自分' : m.name;
        return (
          <button key={m.id} role="tab" aria-selected={on} className={'mdot' + (on ? ' on' : '')} onClick={() => onPick(m.id)}
            aria-label={`${name}・${word[st.kind]}`} title={name}>
            <Avatar id={m.id} name={m.name} size={32} color={memberColor(group, m.id)} />
            <span className={'member-dot ' + st.kind} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * スマホ：上のバーの左（アプリのアイコンの場所）に、見ている人（ふつうは自分）のアイコンを1つだけ。
 * 押すと、メンバー全員のアイコンと仕事の状況をポップアップで出し、選んだ人の予定に切り替える
 */
export function MemberMenu({ state, group, who, today, onPick }: {
  state: State; group: Group; who: string; today: string; onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const now = useNowMin();
  const me = state.me!.id;
  const members = [...group.members].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
  const cur = members.find(m => m.id === who) || members[0];
  const st = statusOf(state, group, cur.id, today, now);
  return (
    <>
      <button className="mdot mmenu-btn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`メンバーと仕事の状況：${cur.id === me ? '自分' : cur.name}`}>
        <Avatar id={cur.id} name={cur.name} size={34} color={memberColor(group, cur.id)} />
        <span className={'member-dot ' + st.kind} />
      </button>
      {open && (
        <div className="mmenu-back" onClick={() => setOpen(false)}>
          <div className="mmenu" role="dialog" aria-label={`${group.name}のメンバー`} onClick={e => e.stopPropagation()}>
            <div className="mmenu-head">{group.name}</div>
            {members.map(m => {
              const s = statusOf(state, group, m.id, today, now);
              return (
                <button key={m.id} className={'mmenu-row' + (m.id === who ? ' on' : '')} onClick={() => { setOpen(false); onPick(m.id); }}>
                  <span className="mmenu-av"><Avatar id={m.id} name={m.name} size={38} color={memberColor(group, m.id)} /><span className={'member-dot ' + s.kind} /></span>
                  <span className="grow"><b>{m.id === me ? '自分' : m.name}</b><span className={'mmenu-st ' + s.kind}>{s.text}</span></span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * メンバーのアイコンを押したときに出る、その人の仕事の詳細。
 * 今やっていること（時間・残り時間・説明）、次の予定、今日の進み具合。
 */
export function MemberFocus({ state, group, who, today, onOpenTask, onClose }: {
  state: State; group: Group; who: string; today: string; onOpenTask: (taskId: string, day: string) => void; onClose: () => void;
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
        <Avatar id={m.id} name={m.name} size={34} color={memberColor(group, m.id)} />
        <div className="grow"><b>{m.name}さん</b><span className="mf-progress">今日 {done}/{list.length} 完了</span></div>
        <div className="mf-bar" aria-hidden="true"><span style={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} /></div>
        <button className="icon-btn mf-close" onClick={onClose} aria-label="自分の予定に戻る"><Icon name="close" size={18} /></button>
      </div>
      {cur ? (
        <button className="mf-now" onClick={() => onOpenTask(cur.task.id, today)} style={{ ['--c' as string]: cur.color }}>
          <span className="mf-label now">いまやっていること</span>
          <span className="mf-title">{cur.task.starred && <span className="star-mark">★</span>}{titleOr(cur.task)}</span>
          <span className="mf-meta">{hm(span(cur).s)}–{hm(span(cur).e)}・あと{span(cur).e - now}分{cur.task.description ? '' : ''}</span>
          {cur.task.description && <span className="mf-desc">{cur.task.description}</span>}
        </button>
      ) : (
        <div className="mf-now free"><span className="mf-label">いまは</span><span className="mf-title">空いています</span></div>
      )}
      {next && (
        <button className="mf-next" onClick={() => onOpenTask(next.task.id, today)}>
          <span className="mf-label">次</span>{next.task.time} {titleOr(next.task)}<span className="mf-meta">あと{span(next).s - now}分</span>
        </button>
      )}
    </div>
  );
}
