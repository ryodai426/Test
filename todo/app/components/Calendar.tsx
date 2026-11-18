'use client';
import { useEffect, useRef, useState } from 'react';
import { addDays, parseDate, weekday, WEEK_LABELS, KIND_PRESETS } from '@/lib/time';
import { occurrences, toMin, fromMin, type Occ, type State } from '../lib';

type Props = {
  state: State;
  cursor: string;
  today: string;
  groupFilter: string;
  onOpen: (o: Occ) => void;
  onNew: (day: string, time?: string) => void;
  onToggle: (o: Occ) => void;
  onPickDay: (day: string) => void;
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function useNowMin() {
  const [m, setM] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  useEffect(() => {
    const id = setInterval(() => { const d = new Date(); setM(d.getHours() * 60 + d.getMinutes()); }, 30000);
    return () => clearInterval(id);
  }, []);
  return m;
}

/** 重なった予定を横に並べる */
function layout(list: Occ[]) {
  const timed = list.filter(o => o.task.time).map(o => {
    const s = toMin(o.task.time!);
    return { o, s, e: Math.min(24 * 60, s + Math.max(20, o.task.duration_min)), lane: 0, lanes: 1 };
  }).sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster: typeof timed = [];
  let clusterEnd = -1;
  const flush = () => {
    const n = Math.max(...cluster.map(c => c.lane)) + 1;
    cluster.forEach(c => (c.lanes = n));
    cluster = [];
  };
  for (const ev of timed) {
    if (cluster.length && ev.s >= clusterEnd) flush();
    const used = new Set(cluster.filter(c => c.e > ev.s).map(c => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    ev.lane = lane;
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.e);
  }
  if (cluster.length) flush();
  return timed;
}

function TimedColumn({ day, list, isToday, nowMin, onOpen, onNew, compact }: {
  day: string; list: Occ[]; isToday: boolean; nowMin: number; compact?: boolean;
  onOpen: (o: Occ) => void; onNew: (day: string, time?: string) => void;
}) {
  const hourPx = 56;
  return (
    <div className="col">
      {HOURS.map(h => (
        <div key={h} className="slot" onClick={() => onNew(day, fromMin(h * 60))} title={`${h}:00 に予定を追加`} />
      ))}
      {layout(list).map(({ o, s, e, lane, lanes }) => (
        <button key={o.task.id + o.day} className={'ev' + (o.done ? ' done' : '')}
          style={{
            top: (s / 60) * hourPx + 1, height: Math.max(22, ((e - s) / 60) * hourPx - 2),
            left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, right: 'auto',
            background: o.color + '33',
          }}
          onClick={ev => { ev.stopPropagation(); onOpen(o); }}>
          <div className="t">{compact ? '' : KIND_PRESETS[o.task.kind]?.icon + ' '}{o.task.title}</div>
          {!compact && <div className="s">{o.task.time}{o.group && !o.group.is_personal ? ` ・${o.group.name}` : ''}</div>}
        </button>
      ))}
      {isToday && <div className="nowline" style={{ top: (nowMin / 60) * hourPx }} />}
    </div>
  );
}

function useScrollToMorning(dep: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.closest('.content') as HTMLElement | null;
    if (!el) return;
    const d = new Date();
    const h = Math.max(0, Math.min(d.getHours() - 1, 17));
    el.scrollTop = Math.max(6, h) * 56 - 10;
  }, [dep]);
  return ref;
}

export function DayView(p: Props) {
  const nowMin = useNowMin();
  const list = occurrences(p.state, p.cursor, p.groupFilter);
  const untimed = list.filter(o => !o.task.time);
  const ref = useScrollToMorning(p.cursor);
  return (
    <div ref={ref}>
      {untimed.length > 0 && (
        <div className="allday" style={{ gridTemplateColumns: '52px 1fr' }}>
          <div className="axis-label">終日</div>
          <div className="allday-cell">
            {untimed.map(o => (
              <div key={o.task.id} className="row">
                <button className={'check' + (o.done ? ' on' : '')} onClick={() => p.onToggle(o)} aria-label="完了">{o.done ? '✓' : ''}</button>
                <button className={'pill' + (o.done ? ' done' : '')} style={{ background: o.color + '33' }} onClick={() => p.onOpen(o)}>
                  <span className="dot" style={{ background: o.color }} />{KIND_PRESETS[o.task.kind]?.icon} {o.task.title}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="daycols" style={{ gridTemplateColumns: '52px 1fr' }}>
        <div className="timecol">{HOURS.map(h => <div key={h} className="hour">{h ? `${h}:00` : ''}</div>)}</div>
        <TimedColumn day={p.cursor} list={list} isToday={p.cursor === p.today} nowMin={nowMin} onOpen={p.onOpen} onNew={p.onNew} />
      </div>
    </div>
  );
}

export function weekStart(day: string) {
  return addDays(day, -((weekday(day) + 6) % 7)); // 月曜はじまり
}

export function WeekView(p: Props) {
  const nowMin = useNowMin();
  const start = weekStart(p.cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const lists = days.map(d => occurrences(p.state, d, p.groupFilter));
  const hasUntimed = lists.some(l => l.some(o => !o.task.time));
  const cols = '44px repeat(7, minmax(0, 1fr))';
  const ref = useScrollToMorning(start);
  return (
    <div ref={ref}>
      <div className="weekhead" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map(d => {
          const w = weekday(d);
          return (
            <button key={d} className={(d === p.today ? 'today ' : '') + (w === 0 ? 'sun' : w === 6 ? 'sat' : '')} onClick={() => p.onPickDay(d)}>
              {WEEK_LABELS[w]}<b>{Number(d.slice(8))}</b>
            </button>
          );
        })}
      </div>
      {hasUntimed && (
        <div className="allday" style={{ gridTemplateColumns: cols, top: 58 }}>
          <div className="axis-label">終日</div>
          {lists.map((l, i) => (
            <div key={i} className="allday-cell">
              {l.filter(o => !o.task.time).map(o => (
                <button key={o.task.id} className={'pill' + (o.done ? ' done' : '')} style={{ background: o.color + '33' }} onClick={() => p.onOpen(o)}>
                  <span className="dot" style={{ background: o.color, width: 6, height: 6 }} />{o.task.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="daycols" style={{ gridTemplateColumns: cols }}>
        <div className="timecol">{HOURS.map(h => <div key={h} className="hour">{h ? `${h}` : ''}</div>)}</div>
        {days.map((d, i) => (
          <TimedColumn key={d} day={d} list={lists[i]} isToday={d === p.today} nowMin={nowMin} onOpen={p.onOpen} onNew={p.onNew} compact />
        ))}
      </div>
    </div>
  );
}

export function MonthView(p: Props) {
  const first = p.cursor.slice(0, 8) + '01';
  const gridStart = addDays(first, -weekday(first));
  const month = p.cursor.slice(0, 7);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  // 6週目が丸ごと翌月なら省く
  const shown = days[35].slice(0, 7) !== month ? days.slice(0, 35) : days;
  return (
    <div className="month">
      {WEEK_LABELS.map((w, i) => <div key={w} className="wh" style={{ color: i === 0 ? '#dc2626' : i === 6 ? '#2563eb' : undefined }}>{w}</div>)}
      {shown.map(d => {
        const list = occurrences(p.state, d, p.groupFilter);
        return (
          <button key={d} className={'mcell' + (d.slice(0, 7) !== month ? ' other' : '') + (d === p.today ? ' today' : '')} onClick={() => p.onPickDay(d)}>
            <span className="n">{Number(d.slice(8))}</span>
            <div className="mdots">
              {list.slice(0, 6).map(o => <span key={o.task.id} className="dot" style={{ background: o.color, width: 7, height: 7, opacity: o.done ? .35 : 1 }} />)}
            </div>
            {list.slice(0, 3).map(o => (
              <span key={o.task.id} className="mtitle" style={{ background: o.color + '33', textDecoration: o.done ? 'line-through' : undefined, opacity: o.done ? .5 : 1 }}>
                {o.task.time ? o.task.time + ' ' : ''}{o.task.title}
              </span>
            ))}
            {list.length > 3 && <span className="mtitle muted">ほか{list.length - 3}件</span>}
          </button>
        );
      })}
    </div>
  );
}

export function periodLabel(view: string, cursor: string) {
  const [y, m] = cursor.split('-').map(Number);
  if (view === 'month') return `${y}年${m}月`;
  if (view === 'week') {
    const s = weekStart(cursor);
    const e = addDays(s, 6);
    return `${Number(s.slice(5, 7))}/${Number(s.slice(8))} – ${Number(e.slice(5, 7))}/${Number(e.slice(8))}`;
  }
  const w = WEEK_LABELS[new Date(parseDate(cursor)).getUTCDay()];
  return `${m}月${Number(cursor.slice(8))}日（${w}）`;
}
