'use client';
import { useState } from 'react';
import { api } from '../lib';

export default function Login({ onDone, initialCode }: { onDone: () => void; initialCode?: string }) {
  const [mode, setMode] = useState<'new' | 'code'>(initialCode ? 'code' : 'new');
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (mode === 'new') {
        await api('auth/register', 'POST', { name, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      } else {
        await api('auth/link', 'POST', { code });
      }
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div style={{ fontSize: 40 }}>📅</div>
        <h1>わすれないTODO</h1>
        {mode === 'new' ? (
          <>
            <p className="muted">忘れる前に気づかせる、みんなのタスク帳。<br />はじめに、あなたの名前を決めてください。</p>
            <input type="text" placeholder="ユーザー名を入力してください" value={name} onChange={e => setName(e.target.value)} autoFocus maxLength={30} />
            <div style={{ height: 12 }} />
            <button className="btn primary block" disabled={!name.trim() || busy}>はじめる</button>
            {err && <div className="err">{err}</div>}
            <div className="hr" />
            <button type="button" className="btn block" onClick={() => { setMode('code'); setErr(''); }}>
              スマホ／PCですでに使っている → コードでログイン
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              すでに使っている端末で <b>⚙ 設定 →「この端末以外でも使う」</b> を開くと、6桁のコードが出ます。それを入力してください。
            </p>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" className="code-input" placeholder="000000"
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
            <div style={{ height: 12 }} />
            <button className="btn primary block" disabled={code.length !== 6 || busy}>ログイン</button>
            {err && <div className="err">{err}</div>}
            <div className="hr" />
            <button type="button" className="btn block" onClick={() => { setMode('new'); setErr(''); }}>はじめて使う</button>
          </>
        )}
      </form>
    </div>
  );
}
