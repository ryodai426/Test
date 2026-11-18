'use client';
import { useEffect, useRef, useState } from 'react';
import { addDays, parseDate, weekday, WEEK_LABELS, KIND_PRESETS } from '@/lib/time';
import Emoji from './Emoji';
import Icon from './Icon';
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

type Span = { o: Occ; s: number; e: number; lane: number; lanes: number };

/** 予定の開始・終了（分） */
function spanOf(o: Occ) {
  const s = toMin(o.task.time!);
  return { s, e: Math.min(24 * 60, s + Math.max(20, o.task.duration_min)) };
}

/** 重なった予定を横に並べる */
function layout(list: Occ[]) {
  return laneLayout(list.filter(o => o.task.time).map(o => ({ o, ...spanOf(o), lane: 0, lanes: 1 })));
}

/** from〜to（分）の時間帯に入る部分だけを切り出して並べる（午前・午後の列用） */
function layoutRange(list: Occ[], from: number, to: number) {
  return laneLayout(list.filter(o => o.task.time).map(o => ({ o, ...spanOf(o), lane: 0, lanes: 1 }))
    .map(x => ({ ...x, s: Math.max(x.s, from), e: Math.min(x.e, to) }))
    .filter(x => x.e > x.s));
}

function laneLayout(spans: Span[]) {
  const timed = spans.sort((a, b) => a.s - b.s || b.e - a.e);
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
            background: o.color + '4d',
          }}
          onClick={ev => { ev.stopPropagation(); onOpen(o); }}>
          <div className="t">{!compact && !o.task.kind_id && <><Emoji char={KIND_PRESETS[o.task.kind]?.icon} size={14} />{' '}</>}{o.task.title}</div>
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
    if (dep === 'split') return;
    const el = ref.current?.closest('.content') as HTMLElement | null;
    if (!el) return;
    const d = new Date();
    const h = Math.max(0, Math.min(d.getHours() - 1, 17));
    el.scrollTop = Math.max(6, h) * 56 - 10;
  }, [dep]);
  return ref;
}

/** PC くらいの横幅か */
function useIsWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** 時刻のない予定（終日） */
function AllDayRow({ list, p, sticky = true }: { list: Occ[]; p: Props; sticky?: boolean }) {
  const untimed = list.filter(o => !o.task.time);
  if (!untimed.length) return null;
  return (
    <div className="allday" style={{ gridTemplateColumns: '52px 1fr', position: sticky ? undefined : 'static' }}>
      <div className="axis-label">終日</div>
      <div className="allday-cell allday-wrap">
        {untimed.map(o => (
          <div key={o.task.id} className="row">
            <button className={'check' + (o.done ? ' on' : '')} onClick={() => p.onToggle(o)} aria-label="完了">{o.done && <Icon name="check" size={13} stroke={2.8} />}</button>
            <button className={'pill' + (o.done ? ' done' : '')} style={{ background: o.color + '4d' }} onClick={() => p.onOpen(o)}>
              <span className="dot" style={{ background: o.color }} />{!o.task.kind_id && <Emoji char={KIND_PRESETS[o.task.kind]?.icon} size={14} />} {o.task.title}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const HALF_HOURS = Array.from({ length: 12 }, (_, i) => i);

/** 午前（0〜12時）・午後（12〜24時）の片方の列。画面の高さに合わせて1時間の高さが決まる */
function HalfDay({ base, list, p, nowMin }: { base: number; list: Occ[]; p: Props; nowMin: number }) {
  const end = base + 720;
  const pct = (m: number) => ((m - base) / 720) * 100;
  const isToday = p.cursor === p.today;
  return (
    <section className="half" aria-label={base ? '午後' : '午前'}>
      <div className="half-head">{base ? '午後' : '午前'}<span>{base ? '12:00 – 24:00' : '0:00 – 12:00'}</span></div>
      <div className="half-grid">
        <div className="half-times">
          {HALF_HOURS.map(h => <div key={h}>{`${base / 60 + h}:00`}</div>)}
        </div>
        <div className="half-col">
          {HALF_HOURS.map(h => (
            <div key={h} className="slot" onClick={() => p.onNew(p.cursor, fromMin(base + h * 60))} title={`${base / 60 + h}:00 に予定を追加`} />
          ))}
          {layoutRange(list, base, end).map(({ o, s, e, lane, lanes }) => (
            <button key={o.task.id + o.day} className={'ev ev-half' + (o.done ? ' done' : '')}
              style={{
                top: `calc(${pct(s)}% + 1px)`, height: `calc(${pct(e) - pct(s)}% - 2px)`,
                left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)`, right: 'auto',
                background: o.color + '4d',
              }}
              onClick={ev => { ev.stopPropagation(); p.onOpen(o); }}>
              <div className="t">
                <span className="s">{s > spanOf(o).s ? '（続き）' : o.task.time}</span>{' '}
                {!o.task.kind_id && <><Emoji char={KIND_PRESETS[o.task.kind]?.icon} size={14} />{' '}</>}{o.task.title}
                {o.group && !o.group.is_personal && <span className="s">{' '}・{o.group.name}</span>}
              </div>
            </button>
          ))}
          {isToday && nowMin >= base && nowMin < end && <div className="nowline" style={{ top: `${pct(nowMin)}%` }} />}
        </div>
      </div>
    </section>
  );
}

export function DayView(p: Props) {
  const nowMin = useNowMin();
  const wide = useIsWide();
  const list = occurrences(p.state, p.cursor, p.groupFilter);
  const ref = useScrollToMorning(wide ? 'split' : p.cursor);
  if (wide) {
    // PC：1日を午前と午後の2列に分け、スクロールせずに見渡せるようにする
    return (
      <div className="daysplit">
        <AllDayRow list={list} p={p} sticky={false} />
        <div className="daysplit-body">
          <HalfDay base={0} list={list} p={p} nowMin={nowMin} />
          <HalfDay base={720} list={list} p={p} nowMin={nowMin} />
        </div>
      </div>
    );
  }
  return (
    <div ref={ref}>
      <AllDayRow list={list} p={p} />
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
                <button key={o.task.id} className={'pill' + (o.done ? ' done' : '')} style={{ background: o.color + '4d' }} onClick={() => p.onOpen(o)}>
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
              <span key={o.task.id} className="mtitle" style={{ background: o.color + '4d', textDecoration: o.done ? 'line-through' : undefined, opacity: o.done ? .5 : 1 }}>
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
