'use client';
import { KIND_PRESETS, WEEK_LABELS, weekday } from '@/lib/time';
import { occurrences, type State } from '../lib';
import Emoji from './Emoji';
import { Scene } from './Icon';

/** 時間帯であいさつを変える */
function greeting(name: string) {
  const h = new Date().getHours();
  const word = h < 4 ? 'こんばんは' : h < 11 ? 'おはよう' : h < 17 ? 'こんにちは' : 'こんばんは';
  return `${word}、${name}さん`;
}

const kindName = (s: State, id: string | null) => (id ? (s.kinds || []).find(k => k.id === id)?.name : '') || '';

// 付箋の傾き（毎回同じ並びになるよう、番号から決める）
const TILT = [-2.2, 1.6, -1, 2.4, -1.8, 1, -2.6, 1.9];

/**
 * その日はじめてアプリを開いたときに出る、今日の予定の一覧（付箋）。
 * 画面のどこを触っても閉じる。
 */
export default function TodayBrief({ state, today, onClose }: { state: State; today: string; onClose: () => void }) {
  const list = occurrences(state, today, 'all');
  const left = list.filter(o => !o.done).length;
  const [, m, d] = today.split('-').map(Number);

  return (
    <div className="brief" onClick={onClose} role="dialog" aria-label="今日の予定">
      <div className="brief-inner">
        <div className="brief-hello">{greeting(state.me!.name)}</div>
        <h2 className="brief-date">{m}月{d}日（{WEEK_LABELS[weekday(today)]}）</h2>
        <div className="brief-sum">
          {list.length === 0 ? '今日の予定はありません' : left === 0 ? `今日の予定 ${list.length}件、ぜんぶ完了！` : `今日の予定 ${list.length}件`}
        </div>

        <div className="brief-board">
          {list.length === 0 && (
            <div className="brief-note" style={{ ['--paper' as string]: 'var(--yellow)', ['--tilt' as string]: '-1.5deg', animationDelay: '.1s' }}>
              <div className="brief-time">FREE</div>
              <div className="brief-title">のんびりできる日です</div>
              <div className="brief-meta">思いついたことは、ひとことメモへ</div>
            </div>
          )}
          {list.map((o, i) => (
            <div key={o.task.id} className={'brief-note' + (o.done ? ' done' : '')}
              style={{
                ['--paper' as string]: `color-mix(in srgb, ${o.color} 30%, #fff)`,
                ['--tape' as string]: o.color,
                ['--tilt' as string]: `${TILT[i % TILT.length]}deg`,
                animationDelay: `${0.08 + i * 0.06}s`,
              }}>
              <div className="brief-time">{o.task.time || '終日'}</div>
              <div className="brief-title">
                {o.task.starred && <span className="star-mark">★</span>}{!o.task.kind_id && <><Emoji char={KIND_PRESETS[o.task.kind]?.icon} size={18} />{' '}</>}{o.task.title}
              </div>
              <div className="brief-meta">
                {[kindName(state, o.task.kind_id), o.group?.name, o.done ? '完了' : ''].filter(Boolean).join('・')}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Scene onGreen />
    </div>
  );
}
