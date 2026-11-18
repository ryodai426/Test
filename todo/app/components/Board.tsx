'use client';
import Icon, { Scene } from './Icon';

/**
 * 付箋のボード（「メモを見る」と同じ見た目）。緑の全画面に大きなタイトル、付箋を並べる。
 * 背景か × を押すと閉じる。付箋の中を押しても閉じない。
 */
export function Board({ eyebrow, title, sum, onClose, children, label }: {
  eyebrow: string; title: string; sum?: React.ReactNode; onClose: () => void; children: React.ReactNode; label: string;
}) {
  return (
    <div className="brief board" onClick={onClose} role="dialog" aria-label={label}>
      <div className="brief-inner">
        <div className="row">
          <div className="brief-hello grow">{eyebrow}</div>
          <button className="icon-btn memo-close" onClick={onClose} aria-label="閉じる"><Icon name="close" size={20} /></button>
        </div>
        <h2 className="brief-date">{title}</h2>
        {sum && <div className="brief-sum">{sum}</div>}
        {children}
      </div>
      <Scene onGreen />
    </div>
  );
}

const TILT = [-1, .8, -.6, 1.1, -.9, .6];

/** ボードに貼る付箋（中を押しても閉じない） */
export function Note({ i, paper, tape, className = '', children }: {
  i: number; paper: string; tape?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={'brief-note board-note ' + className} onClick={e => e.stopPropagation()}
      style={{ ['--paper' as string]: paper, ['--tape' as string]: tape || 'var(--coral)', ['--tilt' as string]: `${TILT[i % TILT.length]}deg`, animationDelay: `${0.05 + i * 0.05}s` }}>
      {children}
    </div>
  );
}

export const PAPERS = ['var(--yellow)', 'var(--lilac)', 'var(--peach)', 'var(--green-2)', '#CDE8FF'];
export const TAPES = ['var(--coral)', 'var(--sky)', 'var(--green)', 'var(--yellow)', 'var(--lilac)'];
