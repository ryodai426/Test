'use client';
import { useEffect, useRef, useState } from 'react';
import { addDays, KIND_PRESETS, WEEK_LABELS, weekday } from '@/lib/time';
import { api, isFor, localDateOf, occurrences, type Occ, type State, type Task } from '../lib';
import Emoji from './Emoji';
import Icon, { Scene } from './Icon';
import { act, P } from '../store';

const EMOJIS = ['👍', '❤️', '💪', '👏'];

// 予定より早く終わったときの、思いきり褒めることば（毎回同じタスクには同じことば）
const PRAISES = [
  (m: number) => `${m}分も前倒し！段取り力が天才的です`,
  (m: number) => `予定より${m}分早くゴール！今日のMVP`,
  (m: number) => `はやっ！${m}分の余白を生み出しました`,
  (m: number) => `${m}分巻きで完了。プロの仕事です`,
  (m: number) => `${m}分も早い！未来の自分が感謝してます`,
];
const pick = <T,>(arr: T[], key: string) => { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0; return arr[Math.abs(h) % arr.length]; };

/** 予定の終わる時刻（ローカル、ms） */
function endAtOf(t: Task, day: string) {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = (t.time || '00:00').split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime() + Math.max(20, t.duration_min) * 60000;
}

type Done = { o: Occ; doneAt: number | null; early: number; by: string | null };

/** 今日の振り返りに使うデータ */
function collect(state: State, today: string) {
  const me = state.me!.id;
  const doneMap = new Map(state.done.map(d => [d.task_id + '|' + d.occ_date, d]));
  const groups = new Map(state.groups.map(g => [g.id, g]));
  const toDone = (o: Occ): Done => {
    const rec = doneMap.get(o.task.id + '|' + o.day);
    const doneAt = o.task.repeat ? (rec?.done_at ? new Date(rec.done_at).getTime() : null) : (o.task.done_at ? new Date(o.task.done_at).getTime() : null);
    const early = o.task.time && doneAt ? Math.floor((endAtOf(o.task, o.day) - doneAt) / 60000) : 0;
    return { o, doneAt, early: early >= 5 ? early : 0, by: o.task.repeat ? rec?.user_id ?? null : o.task.done_by };
  };
  // 自分のこなしたタスク：今日の予定で完了したもの＋今日完了した日付なし・別の日の予定
  const mineToday = occurrences(state, today, 'all');
  const done: Done[] = mineToday.filter(o => o.done).map(toDone);
  for (const t of state.tasks) {
    if (t.status !== 'ready' || t.repeat || !t.done_at || t.date === today || !isFor(t, me, state)) continue;
    if (localDateOf(t.done_at) !== today) continue;
    const g = groups.get(t.group_id);
    done.push(toDone({ task: t, day: t.date || today, done: true, group: g, color: t.color || g?.color || '#6B7280' }));
  }
  // 仲間のがんばり：共有グループで、今日ほかの人が完了したもの
  const team: Done[] = [];
  for (const t of state.tasks) {
    const g = groups.get(t.group_id);
    if (!g || g.is_personal || t.status !== 'ready') continue;
    const color = t.color || g.color;
    if (t.repeat) {
      for (const d of state.done) {
        if (d.task_id !== t.id || d.occ_date !== today || d.user_id === me) continue;
        team.push(toDone({ task: t, day: today, done: true, group: g, color }));
      }
    } else if (t.done_at && t.done_by && t.done_by !== me && localDateOf(t.done_at) === today) {
      team.push(toDone({ task: t, day: t.date || today, done: true, group: g, color }));
    }
  }
  const registered = state.tasks.filter(t => t.user_id === me && localDateOf(t.captured_at) === today)
    .sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const tomorrow = occurrences(state, addDays(today, 1), 'all');
  return { done, team, registered, tomorrow, total: mineToday.length };
}

// ---------------------------------------------------------------- ご褒美の演出

/** こなした数で、紙吹雪 → クラッカー → 風船 と派手になる */
function Celebration({ count }: { count: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const level = count >= 6 ? 3 : count >= 3 ? 2 : count >= 1 ? 1 : 0;
  useEffect(() => {
    const cv = ref.current;
    if (!cv || reduce || level === 0) return;
    const ctx = cv.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
    const colors = ['#8ED462', '#F5E211', '#FF705D', '#2BA0FF', '#EBC1FF', '#FFBE9F'];
    type P = { x: number; y: number; vx: number; vy: number; r: number; vr: number; w: number; h: number; c: string; life: number };
    const ps: P[] = [];
    const burst = (x: number, y: number, n: number, angle: number, spread: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() - .5) * spread;
        const v = speed * (.55 + Math.random() * .6);
        ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
          w: 6 + Math.random() * 6, h: 3 + Math.random() * 5, c: colors[(Math.random() * colors.length) | 0], life: 1 });
      }
    };
    if (level === 1) burst(W / 2, H * .35, 70, -Math.PI / 2, Math.PI * 1.2, 11);
    else {
      // 左右の下からクラッカー
      burst(0, H, level === 3 ? 150 : 110, -Math.PI / 3.2, .7, 21);
      burst(W, H, level === 3 ? 150 : 110, -Math.PI + Math.PI / 3.2, .7, 21);
      if (level === 3) setTimeout(() => burst(W / 2, H * .3, 120, -Math.PI / 2, Math.PI * 1.6, 13), 450);
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.vy += .32; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (t - t0 > 2600) p.life -= .02;
        ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (t - t0 < 4600) raf = requestAnimationFrame(tick); else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level, reduce]);

  const balloons = level === 3 && !reduce ? Array.from({ length: 9 }, (_, i) => i) : [];
  const bColors = ['#FF705D', '#2BA0FF', '#F5E211', '#8ED462', '#EBC1FF', '#FFBE9F'];
  return (
    <>
      <canvas ref={ref} className="celebrate" aria-hidden="true" />
      {balloons.length > 0 && (
        <div className="balloons" aria-hidden="true">
          {balloons.map(i => (
            <svg key={i} className="balloon" viewBox="0 0 40 70" style={{ left: `${6 + i * 10.5}%`, animationDelay: `${(i % 4) * .35 + (i % 2) * .2}s`, animationDuration: `${4.2 + (i % 3) * .7}s` }}>
              <path d="M20 2C9 2 3 11 3 21c0 12 9 21 17 23 8-2 17-11 17-23C37 11 31 2 20 2z" fill={bColors[i % bColors.length]} stroke="#2C2E2A" strokeWidth="1.8" />
              <path d="M17 44l3 4 3-4z" fill={bColors[i % bColors.length]} stroke="#2C2E2A" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M20 48c-3 6 3 10 0 21" fill="none" stroke="#2C2E2A" strokeWidth="1.3" />
              <path d="M11 14c1-4 4-6 7-7" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- 振り返り画面

function Reactions({ state, task, day, canReact, onReact }: { state: State; task: Task; day: string; canReact: boolean; onReact: (emoji: string) => void }) {
  const me = state.me!.id;
  const rs = state.reactions.filter(r => r.task_id === task.id && r.occ_date === day);
  const counts = EMOJIS.map(e => ({ e, n: rs.filter(r => r.emoji === e).length, mine: rs.some(r => r.emoji === e && r.user_id === me) }));
  if (!canReact && !rs.length) return null;
  return (
    <div className="review-reacts" onClick={e => e.stopPropagation()}>
      {counts.filter(c => canReact || c.n > 0).map(c => (
        <button key={c.e} className={'review-react' + (c.mine ? ' mine' : '')} disabled={!canReact || c.mine}
          onClick={() => onReact(c.e)} aria-label={`${c.e} ${c.n}`}>
          <Emoji char={c.e} size={20} />{c.n > 0 && <span>{c.n}</span>}
        </button>
      ))}
    </div>
  );
}

const TILT = [-1.8, 1.4, -1, 2, -1.5, 1, -2.2, 1.7];
const timeRange = (t: Task) => {
  if (!t.time) return '終日';
  const [h, m] = t.time.split(':').map(Number);
  const e = h * 60 + m + t.duration_min;
  return `${t.time}–${String(Math.floor(e / 60) % 24).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
};

function Note({ i, color, children, className = '' }: { i: number; color: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={'brief-note review-note ' + className}
      style={{ ['--paper' as string]: `color-mix(in srgb, ${color} 30%, #fff)`, ['--tape' as string]: color, ['--tilt' as string]: `${TILT[i % TILT.length]}deg`, animationDelay: `${0.15 + i * 0.05}s` }}>
      {children}
    </div>
  );
}

export function Review({ state, today, onClose, reload }: { state: State; today: string; onClose: () => void; reload: () => Promise<void> | void }) {
  const me = state.me!;
  const { done, team, registered, tomorrow, total } = collect(state, today);
  const tm = addDays(today, 1);
  const [m, d] = today.split('-').slice(1).map(Number);
  const earlyCount = done.filter(x => x.early).length;
  const memberName = (id: string | null) => state.groups.flatMap(g => g.members).find(x => x.id === id)?.name || '';
  const headline = done.length === 0 ? '今日はおやすみモード' : done.length === total && total > 0 ? `ぜんぶクリア！${done.length}個` : `${done.length}個クリア！`;
  const sub = done.length === 0 ? '休むのも大事な仕事。明日もいっしょにがんばろう'
    : done.length >= 6 ? '今日を走り切りました。ほんとうにおつかれさま！'
    : done.length >= 3 ? 'しっかり進んだ1日でした。えらい！'
    : 'ちゃんと前に進みました。おつかれさま！';

  function react(task: Task, day: string, emoji: string) {
    act(P.addReaction(task.id, day, me.id, emoji), () => api('reactions', 'POST', { task_id: task.id, occ_date: day, emoji }));
  }

  return (
    <div className="brief review" role="dialog" aria-label="今日の振り返り">
      <Celebration count={done.length} />
      <div className="brief-inner">
        <div className="row">
          <div className="brief-hello grow">今日もおつかれさまでした、{me.name}さん・{m}月{d}日（{WEEK_LABELS[weekday(today)]}）</div>
          <button className="icon-btn memo-close" onClick={onClose} aria-label="閉じる"><Icon name="close" size={20} /></button>
        </div>
        <h2 className="brief-date review-head">{headline}</h2>
        <div className="brief-sum">{sub}</div>
        {earlyCount > 0 && <div className="review-early-sum"><Emoji char="✨" size={18} /> 予定より早く終えたタスクが{earlyCount}個も！</div>}

        <h3 className="review-sec">こなしたタスク</h3>
        <div className="brief-board">
          {done.length === 0 && <Note i={0} color="#F5E211"><div className="brief-title">明日のじぶんに期待</div></Note>}
          {done.map((x, i) => (
            <Note key={x.o.task.id + x.o.day} i={i} color={x.o.color} className={x.early ? 'early' : ''}>
              {x.early > 0 && <div className="early-badge"><Emoji char="🎉" size={16} /> {pick(PRAISES, x.o.task.id)(x.early)}</div>}
              <div className="brief-time">{x.o.task.time || '終日'}</div>
              <div className="brief-title">{x.o.task.starred && <span className="star-mark">★</span>}{!x.o.task.kind_id && <><Emoji char={KIND_PRESETS[x.o.task.kind]?.icon} size={18} />{' '}</>}{x.o.task.title}</div>
              <div className="brief-meta">{x.o.group && !x.o.group.is_personal ? x.o.group.name : '個人'}</div>
              <Reactions state={state} task={x.o.task} day={x.o.day} canReact={false} onReact={() => {}} />
            </Note>
          ))}
        </div>

        <h3 className="review-sec">明日の予定<span>{Number(tm.slice(5, 7))}月{Number(tm.slice(8))}日（{WEEK_LABELS[weekday(tm)]}）</span></h3>
        <div className="brief-board">
          {tomorrow.length === 0 && <Note i={2} color="#8ED462"><div className="brief-title">予定なし。のんびりいこう</div></Note>}
          {tomorrow.map((o, i) => (
            <Note key={o.task.id} i={i + 2} color={o.color}>
              <div className="brief-time">{timeRange(o.task)}</div>
              <div className="brief-title">{o.task.starred && <span className="star-mark">★</span>}{o.task.title}</div>
              <div className="brief-meta">{o.group && !o.group.is_personal ? o.group.name : '個人'}</div>
            </Note>
          ))}
        </div>

        {team.length > 0 && (
          <>
            <h3 className="review-sec">仲間のがんばり</h3>
            <div className="brief-board">
              {team.map((x, i) => (
                <Note key={x.o.task.id + x.o.day + i} i={i + 3} color={x.o.color}>
                  <div className="brief-time">{memberName(x.by)}さん</div>
                  <div className="brief-title">{x.o.task.title}</div>
                  <div className="brief-meta">{x.o.group?.name}{x.early ? `・予定より${x.early}分早く完了` : ''}</div>
                  <Reactions state={state} task={x.o.task} day={x.o.day} canReact onReact={e => react(x.o.task, x.o.day, e)} />
                </Note>
              ))}
            </div>
          </>
        )}

        <h3 className="review-sec">今日登録したタスク</h3>
        <div className="brief-board">
          {registered.length === 0 && <Note i={1} color="#EBC1FF"><div className="brief-title">なし</div></Note>}
          {registered.map((t, i) => {
            const g = state.groups.find(x => x.id === t.group_id);
            return (
              <Note key={t.id} i={i + 1} color={t.color || g?.color || '#EBC1FF'}>
                <div className="brief-time">{t.status === 'draft' ? 'メモ' : t.date ? `${Number(t.date.slice(5, 7))}/${Number(t.date.slice(8))}` : 'いつか'}</div>
                <div className="brief-title">{t.title || 'ひとことなし'}</div>
                {t.status === 'draft' && t.description && <div className="memo-desc">{t.description}</div>}
              </Note>
            );
          })}
        </div>

        <div className="review-foot">
          <button className="btn white block big" onClick={onClose}>おつかれさまでした！<span className="orb"><Icon name="right" size={18} stroke={2.4} /></span></button>
        </div>
      </div>
      <Scene onGreen />
    </div>
  );
}

/** 夕方に開いたとき、その日1回だけ聞く */
export function ReviewPrompt({ onOpen, onClose }: { onOpen: (skip: boolean) => void; onClose: (skip: boolean) => void }) {
  const [skip, setSkip] = useState(false);
  return (
    <div className="banner" role="alertdialog" aria-label="今日の振り返り">
      <div className="banner-card review-prompt">
        <div className="big"><Emoji char="🎉" size={44} /></div>
        <h2>今日の振り返りを見ますか？</h2>
        <div className="confirm-actions">
          <button className="btn white big" onClick={() => onOpen(skip)}>見る<span className="orb"><Icon name="right" size={18} stroke={2.4} /></span></button>
          <button className="btn" onClick={() => onClose(skip)}>そのまま閉じる</button>
        </div>
        <label className="review-skip">
          <input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} />今後はスキップする
        </label>
      </div>
    </div>
  );
}
