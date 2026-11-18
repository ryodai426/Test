'use client';
import { useEffect, useRef, useState } from 'react';
import { addDays, parseDate, weekday, WEEK_LABELS, KIND_PRESETS } from '@/lib/time';
import Emoji from './Emoji';
import Icon from './Icon';
import { byImportance, followupOf, occurrences, toMin, fromMin, type Occ, type State } from '../lib';

/** 予定の名前（星付きなら★） */
function Title({ o, icon = true, size = 14 }: { o: Occ; icon?: boolean; size?: number }) {
  return (
    <>
      {o.task.starred && <span className="star-mark" aria-label="星付き">★</span>}
      {icon && !o.task.kind_id && <><Emoji char={KIND_PRESETS[o.task.kind]?.icon} size={size} />{' '}</>}
      {o.task.title}
    </>
  );
}

/** タイムスケジュール上の完了ボタン（入力画面を開かずに、その場で完了にする） */
function DoneButton({ o, onToggle, size = 22 }: { o: Occ; onToggle: (o: Occ) => void; size?: number }) {
  return (
    <button className={'ev-check' + (o.done ? ' on' : '')} style={{ width: size, height: size }}
      aria-label={o.done ? '未完了に戻す' : '完了にする'} title={o.done ? '未完了に戻す' : '完了にする'}
      onClick={e => { e.stopPropagation(); onToggle(o); }}>
      <Icon name="check" size={Math.round(size * 0.6)} stroke={2.8} />
    </button>
  );
}

/** 「保留」中かどうか */
const isHeld = (state: State, o: Occ) => followupOf(state, o.task.id, o.day)?.state === 'held';

type Props = {
  state: State;
  cursor: string;
  today: string;
  groupFilter: string;
  onOpen: (o: Occ) => void;
  onNew: (day: string, time?: string, duration?: number) => void;
  onToggle: (o: Occ) => void;
  onPickDay: (day: string) => void;
  who?: string; // 誰の予定を出すか（省略＝自分）
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * 空いている欄をなぞって、30分刻みで時間を選ぶ。
 * スマホ：長押し（0.35秒）してから上下になぞる。PC：押したまま上下に動かす。端まで行くと自動でスクロール。
 * 軽く押しただけなら、押した位置から1時間。
 */
function useRangeSelect(minuteAt: (y: number, height: number) => number, lo: number, hi: number, onPick: (s: number, e: number) => void) {
  const colRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const st = useRef<{ id: number; x: number; y: number; type: string; timer: ReturnType<typeof setTimeout> | null; active: boolean; a: number; b: number } | null>(null);
  const snap = (m: number) => Math.min(hi - 30, Math.max(lo, Math.floor(m / 30) * 30));
  const minAt = (clientY: number) => {
    const r = colRef.current!.getBoundingClientRect();
    return snap(minuteAt(clientY - r.top, r.height));
  };
  // なぞっている間は、画面がスクロールしないようにする（iPhone 対策）
  useEffect(() => {
    const el = colRef.current;
    if (!el) return;
    const tm = (e: TouchEvent) => { if (st.current?.active) e.preventDefault(); };
    const cm = (e: Event) => { if (st.current) e.preventDefault(); }; // 長押しのメニューを出さない
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('contextmenu', cm);
    return () => { el.removeEventListener('touchmove', tm); el.removeEventListener('contextmenu', cm); };
  }, []);
  const autoScroll = (clientY: number) => {
    const box = colRef.current?.closest('.content') as HTMLElement | null;
    if (!box) return;
    const r = box.getBoundingClientRect();
    if (clientY < r.top + 48) box.scrollBy(0, -14);
    else if (clientY > r.bottom - 48) box.scrollBy(0, 14);
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!(e.target as HTMLElement).classList.contains('slot') || e.button > 0) return;
      const a = minAt(e.clientY);
      const s = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, timer: null as ReturnType<typeof setTimeout> | null, active: false, a, b: a };
      if (e.pointerType !== 'mouse') {
        s.timer = setTimeout(() => { s.active = true; setSel({ a, b: a }); navigator.vibrate?.(12); }, 350);
      }
      st.current = s;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = st.current;
      if (!s || e.pointerId !== s.id) return;
      if (!s.active) {
        const dist = Math.abs(e.clientY - s.y) + Math.abs(e.clientX - s.x);
        if (dist < 8) return;
        if (s.type !== 'mouse') { if (s.timer) clearTimeout(s.timer); st.current = null; return; } // スクロールしたいだけ
        s.active = true;
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }
      s.b = minAt(e.clientY);
      setSel({ a: s.a, b: s.b });
      autoScroll(e.clientY);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = st.current;
      if (!s || e.pointerId !== s.id) return;
      if (s.timer) clearTimeout(s.timer);
      st.current = null;
      setSel(null);
      if (s.active) onPick(Math.min(s.a, s.b), Math.max(s.a, s.b) + 30);
      else onPick(s.a, Math.min(hi, s.a + 60));
    },
    onPointerCancel: () => { if (st.current?.timer) clearTimeout(st.current.timer); st.current = null; setSel(null); },
  };
  const range = sel ? { s: Math.min(sel.a, sel.b), e: Math.max(sel.a, sel.b) + 30 } : null;
  return { colRef, handlers, range };
}

function rangeLabel(s: number, e: number) {
  const d = e - s;
  const len = d < 60 ? `${d}分` : d % 60 ? `${Math.floor(d / 60)}時間${d % 60}分` : `${d / 60}時間`;
  return `${fromMin(s)}–${e >= 1440 ? '24:00' : fromMin(e)}・${len}`;
}

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

function TimedColumn({ day, list, isToday, nowMin, onOpen, onNew, onToggle, compact, state }: {
  day: string; list: Occ[]; isToday: boolean; nowMin: number; compact?: boolean; state: State;
  onOpen: (o: Occ) => void; onNew: (day: string, time?: string, duration?: number) => void; onToggle: (o: Occ) => void;
}) {
  const hourPx = 56;
  const { colRef, handlers, range } = useRangeSelect(y => (y / hourPx) * 60, 0, 1440, (s, e) => onNew(day, fromMin(s), e - s));
  return (
    <div className="col selectable" ref={colRef} {...handlers}>
      {HOURS.map(h => (
        <div key={h} className="slot" title={`${h}:00 に予定を追加（長押しでなぞると時間を選べます）`} />
      ))}
      {range && (
        <div className="sel-range" style={{ top: (range.s / 60) * hourPx, height: ((range.e - range.s) / 60) * hourPx }}>
          <span>{rangeLabel(range.s, range.e)}</span>
        </div>
      )}
      {layout(list).map(({ o, s, e, lane, lanes }) => (
        <div key={o.task.id + o.day} role="button" tabIndex={0} className={'ev has-check' + (o.done ? ' done' : '') + (compact ? ' compact' : '')}
          style={{
            top: (s / 60) * hourPx + 1, height: Math.max(22, ((e - s) / 60) * hourPx - 2),
            left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, right: 'auto',
            background: o.color + '4d',
          }}
          onClick={ev => { ev.stopPropagation(); onOpen(o); }}
          onKeyDown={ev => { if (ev.key === 'Enter') onOpen(o); }}>
          <DoneButton o={o} onToggle={onToggle} size={compact ? 18 : 22} />
          <div className="t"><Title o={o} icon={!compact} /></div>
          {!compact && <div className="s">{o.task.time}{o.group && !o.group.is_personal ? ` ・${o.group.name}` : ''}{isHeld(state, o) && <span className="held-tag">保留</span>}</div>}
          {compact && isHeld(state, o) && <span className="held-tag">保留</span>}
        </div>
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
              <span className="dot" style={{ background: o.color }} /><Title o={o} />
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
  const { colRef, handlers, range } = useRangeSelect((y, h) => base + (y / h) * 720, base, end, (s, e) => p.onNew(p.cursor, fromMin(s), e - s));
  return (
    <section className="half" aria-label={base ? '午後' : '午前'}>
      <div className="half-head">{base ? '午後' : '午前'}<span>{base ? '12:00 – 24:00' : '0:00 – 12:00'}</span></div>
      <div className="half-grid">
        <div className="half-times">
          {HALF_HOURS.map(h => <div key={h}>{`${base / 60 + h}:00`}</div>)}
        </div>
        <div className="half-col selectable" ref={colRef} {...handlers}>
          {HALF_HOURS.map(h => (
            <div key={h} className="slot" title={`${base / 60 + h}:00 に予定を追加（押したまま動かすと時間を選べます）`} />
          ))}
          {range && (
            <div className="sel-range" style={{ top: `${pct(range.s)}%`, height: `${pct(range.e) - pct(range.s)}%` }}>
              <span>{rangeLabel(range.s, range.e)}</span>
            </div>
          )}
          {layoutRange(list, base, end).map(({ o, s, e, lane, lanes }) => (
            <div key={o.task.id + o.day} role="button" tabIndex={0} className={'ev ev-half has-check' + (o.done ? ' done' : '')}
              style={{
                top: `calc(${pct(s)}% + 1px)`, height: `calc(${pct(e) - pct(s)}% - 2px)`,
                left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)`, right: 'auto',
                background: o.color + '4d',
              }}
              onClick={ev => { ev.stopPropagation(); p.onOpen(o); }}
              onKeyDown={ev => { if (ev.key === 'Enter') p.onOpen(o); }}>
              <DoneButton o={o} onToggle={p.onToggle} size={20} />
              <div className="t">
                <span className="s">{s > spanOf(o).s ? '（続き）' : o.task.time}</span>{' '}
                <Title o={o} />
                {o.group && !o.group.is_personal && <span className="s">{' '}・{o.group.name}</span>}
                {isHeld(p.state, o) && <span className="held-tag">保留</span>}
              </div>
            </div>
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
  const list = occurrences(p.state, p.cursor, p.groupFilter, p.who);
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
        <TimedColumn day={p.cursor} list={list} isToday={p.cursor === p.today} nowMin={nowMin} onOpen={p.onOpen} onNew={p.onNew} onToggle={p.onToggle} state={p.state} />
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
  const lists = days.map(d => occurrences(p.state, d, p.groupFilter, p.who));
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
          <TimedColumn key={d} day={d} list={lists[i]} isToday={d === p.today} nowMin={nowMin} onOpen={p.onOpen} onNew={p.onNew} onToggle={p.onToggle} state={p.state} compact />
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
        // 星付き → 設定した時間が長い順（長いほど重要）に上から3件
        const list = occurrences(p.state, d, p.groupFilter, p.who).sort(byImportance);
        return (
          <button key={d} className={'mcell' + (d.slice(0, 7) !== month ? ' other' : '') + (d === p.today ? ' today' : '')} onClick={() => p.onPickDay(d)}>
            <span className="n">{Number(d.slice(8))}</span>
            <div className="mdots">
              {list.slice(0, 6).map(o => <span key={o.task.id} className="dot" style={{ background: o.color, width: 7, height: 7, opacity: o.done ? .35 : 1 }} />)}
            </div>
            {list.slice(0, 3).map(o => (
              <span key={o.task.id} className="mtitle" style={{ background: o.color + '4d', textDecoration: o.done ? 'line-through' : undefined, opacity: o.done ? .5 : 1 }}>
                {o.task.starred && <span className="star-mark">★</span>}{o.task.time ? o.task.time + ' ' : ''}{o.task.title}
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
