'use client';
import { useState } from 'react';
import { api } from '../lib';
import Icon, { Logo, Scene } from './Icon';

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
      <div className="login-hero">
        <h1>忘れる前に、<br />気づける。</h1>
      </div>
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark"><Logo size={34} />わすれないYO</div>
        {mode === 'new' ? (
          <>
            <input type="text" placeholder="ユーザー名を入力してください" value={name} onChange={e => setName(e.target.value)} autoFocus maxLength={30} />
            <div style={{ height: 12 }} />
            <button className="btn primary block big" disabled={!name.trim() || busy}>はじめる<span className="orb"><Icon name="right" size={18} stroke={2.4} /></span></button>
            {err && <div className="err">{err}</div>}
            <div className="hr" />
            <button type="button" className="btn block" onClick={() => { setMode('code'); setErr(''); }}>
              ほかの端末で使っている → コードでログイン
            </button>
          </>
        ) : (
          <>
            <p className="muted">ほかの端末の「設定 → ほかの端末で使う」に出る6桁</p>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" className="code-input" placeholder="000000"
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
            <div style={{ height: 12 }} />
            <button className="btn primary block big" disabled={code.length !== 6 || busy}>ログイン<span className="orb"><Icon name="right" size={18} stroke={2.4} /></span></button>
            {err && <div className="err">{err}</div>}
            <div className="hr" />
            <button type="button" className="btn block" onClick={() => { setMode('new'); setErr(''); }}>はじめて使う</button>
          </>
        )}
      </form>
      <Scene onGreen />
    </div>
  );
}
