'use client';
// 削除の確認（「今後は表示しない」を選べる）。ブラウザの confirm() ではチェックボックスを出せないため、自前で出す
import { useEffect, useState } from 'react';

type Ask = { message: string; key: string; label: string; resolve: (ok: boolean) => void };
let show: ((a: Ask) => void) | null = null;
const SKIP = (key: string) => `skip-confirm:${key}`;

function skipped(key: string) {
  try { return localStorage.getItem(SKIP(key)) === '1'; } catch { return false; }
}

/**
 * 削除してよいか聞く。key ごとに「今後は表示しない」を覚える（task＝予定・メモ、checklist＝リスト、kind＝種類）。
 * 表示しないにしてあれば、聞かずに true
 */
export function confirmDelete(message: string, key: string, label = '削除'): Promise<boolean> {
  if (skipped(key)) return Promise.resolve(true);
  if (!show) return Promise.resolve(window.confirm(message));
  return new Promise(resolve => show!({ message, key, label, resolve }));
}

/** 「今後は表示しない」にした確認があるか（設定で元に戻すボタンを出すため） */
export function hasSkippedConfirms(): boolean {
  try { return Object.keys(localStorage).some(k => k.startsWith('skip-confirm:')); } catch { return false; }
}
export function resetSkippedConfirms() {
  try { Object.keys(localStorage).filter(k => k.startsWith('skip-confirm:')).forEach(k => localStorage.removeItem(k)); } catch { /* なし */ }
}

export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [skip, setSkip] = useState(false);
  useEffect(() => { show = a => { setSkip(false); setAsk(a); }; return () => { show = null; }; }, []);
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); answer(false); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.stopImmediatePropagation(); answer(true); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  if (!ask) return null;
  function answer(ok: boolean) {
    if (!ask) return;
    if (ok && skip) { try { localStorage.setItem(SKIP(ask.key), '1'); } catch { /* なし */ } }
    ask.resolve(ok);
    setAsk(null);
  }
  return (
    <div className="banner confirm-delete" onClick={e => { e.stopPropagation(); answer(false); }}>
      <div className="banner-card scope-card" role="alertdialog" aria-label={ask.message} onClick={e => e.stopPropagation()}>
        <h2 style={{ whiteSpace: 'pre-line' }}>{ask.message}</h2>
        <div className="confirm-actions">
          <button className="btn big danger" onClick={() => answer(true)}>{ask.label}</button>
          <button className="btn" onClick={() => answer(false)}>キャンセル</button>
        </div>
        <label className="review-skip">
          <input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} />今後は表示しない
        </label>
      </div>
    </div>
  );
}
