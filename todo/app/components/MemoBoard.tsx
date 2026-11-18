'use client';
import { useState } from 'react';
import { api, hhmm, localDateOf, localToday, fmtJpDate, type State, type Task } from '../lib';
import Icon, { Scene } from './Icon';

// 付箋の紙の色と傾き（番号から決めて、毎回同じ並びに）
const PAPERS = ['var(--yellow)', 'var(--lilac)', 'var(--peach)', 'var(--green-2)', '#CDE8FF'];
const TAPES = ['var(--coral)', 'var(--sky)', 'var(--green)', 'var(--yellow)', 'var(--lilac)'];
const TILT = [-2, 1.5, -1, 2.2, -1.6, 1.1, -2.4, 1.8];

/**
 * 「メモを見る」画面。思いついたらすぐメモした内容を、付箋として貼って並べる。
 * 付箋を押すとそのメモを開く。背景を押すか × で閉じる。
 */
export default function MemoBoard({ state, onClose, onOpen, reload, notify }: {
  state: State; onClose: () => void; onOpen: (t: Task) => void; reload: () => Promise<void> | void; notify: (m: string) => void;
}) {
  const memos = state.tasks.filter(t => t.status === 'draft' && t.user_id === state.me!.id)
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  const [text, setText] = useState('');
  const today = localToday();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    await api('tasks', 'POST', { quick: true, title: t });
    setText('');
    notify('メモを貼りました');
    reload();
  }

  return (
    <div className="brief memo-board" onClick={onClose} role="dialog" aria-label="メモ">
      <div className="brief-inner">
        <div className="row">
          <div className="brief-hello grow">貼ってあるメモ</div>
          <button className="icon-btn memo-close" onClick={onClose} aria-label="閉じる"><Icon name="close" size={20} /></button>
        </div>
        <h2 className="brief-date">メモ</h2>
        <div className="brief-sum">{memos.length ? `${memos.length}枚` : 'まだありません'}</div>

        <form className="memo-add" onClick={e => e.stopPropagation()} onSubmit={add}>
          <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="ひとこと書いて貼る" maxLength={120} />
          <button className="btn primary" disabled={!text.trim()}>貼る</button>
        </form>

        <div className="brief-board">
          {memos.map((t, i) => {
            const d = localDateOf(t.captured_at);
            return (
              <button key={t.id} className="brief-note memo-note"
                style={{
                  ['--paper' as string]: PAPERS[i % PAPERS.length],
                  ['--tape' as string]: TAPES[i % TAPES.length],
                  ['--tilt' as string]: `${TILT[i % TILT.length]}deg`,
                  animationDelay: `${0.06 + i * 0.05}s`,
                }}
                onClick={e => { e.stopPropagation(); onOpen(t); }}>
                <div className="brief-title memo-title">{t.title || <span className="muted">（ひとことなし）</span>}</div>
                {t.description && <div className="memo-desc">{t.description}</div>}
                <div className="brief-meta">{d === today ? '今日' : fmtJpDate(d)} {hhmm(t.captured_at)}</div>
              </button>
            );
          })}
        </div>
      </div>
      <Scene onGreen />
    </div>
  );
}
