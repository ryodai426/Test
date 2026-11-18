'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, DRAFT_STEPS, occursOn, reminderMessage, reminderTimes, KIND_PRESETS } from '@/lib/time';
import { api, ApiError, isDemo, sw, localToday, occurrences, type Checklist, type Occ, type State, type Task } from './lib';
import Login from './components/Login';
import Icon, { Logo, Scene } from './components/Icon';
import Emoji, { EmojiText } from './components/Emoji';
import TodayBrief from './components/TodayBrief';
import { DayView, MonthView, WeekView, periodLabel } from './components/Calendar';
import TaskEditor, { type EditorInit } from './components/TaskEditor';
import {
  ChecklistPanel, DraftsPanel, FullChecklist, GroupDrawer, MembersPanel, NoticePanel, SettingsPanel, ShoppingPanel, checklistDue,
} from './components/Panels';

type View = 'day' | 'week' | 'month';
type Panel = null | 'drafts' | 'shopping' | 'checklists' | 'groups' | 'members' | 'settings' | 'notices';
type Sticky = { key: string; kind: 'done' | 'created' | 'reaction' | 'draft'; body: string; taskId?: string | null; occDate?: string | null; noticeId?: number };

const LS = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 容量オーバーなど */ } },
};

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [view, setView] = useState<View>('day');
  const [today, setToday] = useState(localToday());
  const [cursor, setCursor] = useState(localToday());
  const [groupFilter, setGroupFilter] = useState('all');
  const [panel, setPanel] = useState<Panel>(null);
  const [editor, setEditor] = useState<EditorInit | null>(null);
  const [fullList, setFullList] = useState<Checklist | null>(null);
  const [brief, setBrief] = useState(false);
  const [stickies, setStickies] = useState<Sticky[]>([]);
  const [banner, setBanner] = useState<{ icon: string; title: string; body: string } | null>(null);
  const [toast, setToast] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capture, setCapture] = useState('');
  const [params] = useState(() => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search)));
  const shownNotices = useRef(new Set<number>());
  const captureRef = useRef<HTMLInputElement>(null);
  const sideCaptureRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<State | null>(null);
  stateRef.current = state;

  const notify = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(t => (t === m ? '' : t)), 2600);
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await api<State>(`state?day=${localToday()}`);
      if (!s.me) { setNeedLogin(true); setState(null); return; }
      setNeedLogin(false);
      setState(s);
      setToday(localToday());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedLogin(true);
    }
  }, []);

  // ---- 起動時 -------------------------------------------------------------
  useEffect(() => {
    const v = LS.get('view') as View | null;
    setView(v || (window.innerWidth >= 900 ? 'week' : 'day'));
    setGroupFilter(LS.get('group') || 'all');
    if (params.get('date')) { setCursor(params.get('date')!); setView('day'); }
    load();
    if (!isDemo()) sw()?.register('/sw.js').catch(() => {});
  }, [load, params]);

  useEffect(() => { LS.set('view', view); }, [view]);
  useEffect(() => { LS.set('group', groupFilter); }, [groupFilter]);

  // 表示中は20秒ごとに更新（スマホで入れた予定がPCにもすぐ出るように）
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const id = setInterval(tick, 20000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); };
  }, [load]);

  // ---- ログイン直後の URL パラメータ（招待・通知から開いた時など） -------------
  const handledParams = useRef(false);
  useEffect(() => {
    if (!state || handledParams.current) return;
    handledParams.current = true;
    const me = state.me!;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== me.tz) api('me', 'PATCH', { tz }).catch(() => {});
    const join = params.get('join');
    if (join) {
      api<{ name: string; n: number }>(`invite/${join}`).then(async g => {
        if (state.groups.some(x => x.invite_token === join)) { notify(`すでに「${g.name}」のメンバーです`); return; }
        if (!confirm(`「${g.name}」（${g.n}人）に参加しますか？`)) return;
        const r = await api<{ id: string }>(`invite/${join}/join`, 'POST');
        await load();
        setGroupFilter(r.id);
        notify(`「${g.name}」に参加しました`);
      }).catch(() => notify('招待リンクが無効です'));
    }
    openFromParams(params, state);
    if (location.search && !isDemo()) history.replaceState(null, '', '/');
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  function openFromParams(p: URLSearchParams, s: State) {
    const edit = p.get('edit');
    if (edit) { const t = s.tasks.find(x => x.id === edit); if (t) setEditor({ task: t }); }
    const cl = p.get('checklist');
    if (cl) { const c = s.checklists.find(x => x.id === cl); if (c) setFullList(c); }
    const d = p.get('date');
    if (d) { setCursor(d); setView('day'); }
  }

  // Service Worker からの合図（見ている最中に届いた通知・通知をタップした時）
  useEffect(() => {
    const container = sw();
    if (!container) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'push') {
        const d = e.data.data || {};
        setBanner({ icon: (d.title || '🔔').split(' ')[0], title: d.title?.split(' ').slice(1).join(' ') || 'お知らせ', body: d.body || '' });
        load();
      } else if (e.data?.type === 'open' && stateRef.current) {
        openFromParams(new URL(e.data.url, location.origin).searchParams, stateRef.current);
      }
    };
    container.addEventListener('message', onMsg);
    return () => container.removeEventListener('message', onMsg);
  }, [load]);

  // ---- メンバーの動きを付箋で出す -----------------------------------------------
  useEffect(() => {
    if (!state) return;
    const fresh = state.notifications.filter(n =>
      !n.read_at && !shownNotices.current.has(n.id) && Date.now() - new Date(n.created_at).getTime() < 86400000);
    fresh.forEach(n => shownNotices.current.add(n.id));
    if (!fresh.length) return;
    setStickies(xs => [
      ...xs,
      ...fresh.slice(0, 3).reverse().map(n => ({ key: 'n' + n.id, kind: n.kind as Sticky['kind'], body: n.body, taskId: n.task_id, occDate: n.occ_date, noticeId: n.id })),
    ].slice(-4));
  }, [state]);

  const dismiss = useCallback((key: string) => {
    setStickies(xs => {
      const s = xs.find(x => x.key === key);
      if (s?.noticeId) api('notifications/read', 'POST', { ids: [s.noticeId] }).catch(() => {});
      return xs.filter(x => x.key !== key);
    });
  }, []);

  useEffect(() => {
    if (!stickies.length || brief) return; // 今日の予定を見ている間は、付箋を勝手に消さない
    const timers = stickies.map(s => setTimeout(() => dismiss(s.key), s.kind === 'done' ? 9000 : 6000));
    return () => timers.forEach(clearTimeout);
  }, [stickies, dismiss, brief]);

  // ---- 開いている間のリマインド（プッシュが使えない端末でも画面に出す） ------------
  useEffect(() => {
    if (!state) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const check = () => {
      const s = stateRef.current;
      if (!s) return;
      const now = Date.now();
      const td = localToday();
      const doneSet = new Set(s.done.map(d => d.task_id + '|' + d.occ_date));
      const myGroups = new Set(s.groups.map(g => g.id));
      for (const t of s.tasks) {
        if (t.status !== 'ready' || !t.time || !t.reminders.length || !myGroups.has(t.group_id)) continue;
        if (t.user_id !== s.me!.id && !t.remind_all) continue;
        for (const day of [td, addDays(td, 1)]) {
          if (!occursOn(t, day)) continue;
          if (t.repeat ? doneSet.has(t.id + '|' + day) : t.done_at) continue;
          for (const r of reminderTimes(t, day, tz)) {
            const key = `fired:${t.id}:${day}:${r.key}`;
            if (r.at > now || r.at < now - 120000 || LS.get(key)) continue;
            LS.set(key, '1');
            setBanner({ icon: (!t.kind_id && KIND_PRESETS[t.kind]?.icon) || '⏰', title: r.key === '0' ? `${t.title}の時間です！` : t.title, body: reminderMessage(t.title, r.key, t.time) });
          }
        }
      }
      // 未記入メモ：2分→5分→10分で、だんだん強く
      for (const t of s.tasks) {
        if (t.status !== 'draft' || t.user_id !== s.me!.id) continue;
        DRAFT_STEPS.forEach((step, i) => {
          const at = new Date(t.captured_at).getTime() + step.min * 60000;
          const key = `fired:draft:${t.id}:${step.min}`;
          if (at > now || at < now - 120000 || LS.get(key)) return;
          LS.set(key, '1');
          if (i === DRAFT_STEPS.length - 1) setBanner({ icon: '📋', title: '未記入のメモ', body: step.text(t.title) });
          else setStickies(xs => [...xs, { key: key, kind: 'draft' as const, body: step.text(t.title), taskId: t.id }].slice(-4));
        });
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [state === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- その日はじめて開いたら、今日の予定を付箋で見せる ------------------------------
  // 端末ごと・人ごとに1日1回（スマホとPCのそれぞれで、その日最初に開いたときに出る）
  const meId = state?.me?.id;
  const briefChecked = useRef(false);
  useEffect(() => {
    if (!meId) return;
    const first = !briefChecked.current;
    briefChecked.current = true;
    const key = `brief:${meId}`;
    if (LS.get(key) === today) return;
    // 通知をタップして開いたときは、目的の画面を優先する（次に開いたときに出す）
    if (first && (params.get('edit') || params.get('checklist'))) return;
    LS.set(key, today);
    setBrief(true);
  }, [meId, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 持ち物チェックリストの自動表示（決まった時間） -------------------------------
  useEffect(() => {
    if (!state || fullList || brief) return;
    const td = localToday();
    const due = state.checklists.find(c => checklistDue(c) && !LS.get(`cl:${c.id}:${td}`) && !c.items.every(i => i.checked));
    if (due) { LS.set(`cl:${due.id}:${td}`, '1'); setFullList(due); }
  }, [state, fullList, brief]);

  // ---- キーボード操作（会社のPC向け） ---------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      if (brief) { setBrief(false); return; } // PC ではどのキーでも閉じる
      if (editor || panel || fullList || banner) { if (e.key === 'Escape') { setEditor(null); setPanel(null); setFullList(null); setBanner(null); } return; }
      const k = e.key.toLowerCase();
      if (k === 'n') { e.preventDefault(); if (window.innerWidth >= 900) sideCaptureRef.current?.focus(); else openCapture(); }
      else if (k === 'a') { e.preventDefault(); setEditor({ day: cursor, groupId: groupFilter !== 'all' ? groupFilter : undefined }); }
      else if (k === 't') setCursor(localToday());
      else if (k === 'd') setView('day');
      else if (k === 'w') setView('week');
      else if (k === 'm') setView('month');
      else if (e.key === 'ArrowLeft') move(-1);
      else if (e.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------------------
  if (needLogin) return <Login initialCode={params.get('code') || undefined} onDone={load} />;
  if (!state) return <div className="login"><div className="muted">読み込み中…</div></div>;

  const me = state.me!;
  const currentGroup = state.groups.find(g => g.id === groupFilter);
  const drafts = state.tasks.filter(t => t.status === 'draft' && t.user_id === me.id);
  const shoppingOpen = state.tasks.filter(t => t.kind === 'shopping' && t.status === 'ready' && !t.done_at && (groupFilter === 'all' || t.group_id === groupFilter));
  const unread = state.notifications.filter(n => !n.read_at).length;
  const someday = state.tasks.filter(t => t.status === 'ready' && !t.date && !t.done_at && t.kind !== 'shopping' && (groupFilter === 'all' || t.group_id === groupFilter));

  function move(dir: number) {
    setCursor(c => {
      if (view === 'day') return addDays(c, dir);
      if (view === 'week') return addDays(c, dir * 7);
      const [y, m] = c.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + dir, 1));
      return d.toISOString().slice(0, 10);
    });
  }

  function openCapture() {
    setCaptureOpen(true);
    // iPhone でキーボードを出すため、タップと同じ流れでフォーカスする
    captureRef.current?.focus();
  }

  async function saveCapture(text: string, fromSide = false) {
    await api('tasks', 'POST', { quick: true, title: text });
    setCapture('');
    if (!fromSide) { setCaptureOpen(false); captureRef.current?.blur(); }
    notify(text ? `「${text}」をメモしました` : 'メモしました。あとで詳細を書きましょう');
    load();
  }

  async function toggleDone(o: Occ) {
    await api(`tasks/${o.task.id}/done`, 'POST', { day: o.day, done: !o.done });
    if (!o.done) notify('完了！おつかれさまです 🎉');
    load();
  }

  function afterShopping() {
    const c = state!.checklists.find(x => x.trigger === 'after_shopping');
    if (c) { setPanel(null); setFullList({ ...c, items: c.items.map(i => ({ ...i, checked: false })) }); }
  }

  const calProps = {
    state, cursor, today, groupFilter,
    onOpen: (o: Occ) => setEditor({ task: o.task, occDay: o.day }),
    onNew: (day: string, time?: string) => setEditor({ day, time, groupId: groupFilter !== 'all' ? groupFilter : undefined }),
    onToggle: toggleDone,
    onPickDay: (d: string) => { setCursor(d); setView('day'); },
  };

  const groupTitle = (
    <>
      {currentGroup ? <span className="dot" style={{ background: currentGroup.color }} /> : null}
      {currentGroup ? currentGroup.name : 'すべて表示'}
    </>
  );

  const todayList = view === 'day' ? occurrences(state, cursor, groupFilter) : [];

  return (
    <div className="shell">
      {/* ---------- PC：左のサイドバー ---------- */}
      <aside className="sidebar">
        <div className="brand"><Logo size={34} /><div><b>わすれないYO</b><small>{isDemo() ? 'Trail Notes · Demo' : 'Trail Notes'}</small></div></div>
        <div className="capture-box">
          <label className="cap-label" htmlFor="side-capture">思いついたら、すぐメモ</label>
          <input id="side-capture" ref={sideCaptureRef} type="text" placeholder="ひとことだけでOK" value={capture} onChange={e => setCapture(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); saveCapture(capture.trim(), true); } if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
          <div className="hint"><kbd>Enter</kbd> で未記入メモに保存（空でもOK）・<kbd>N</kbd> でここへ</div>
        </div>
        <button className="btn primary block big" onClick={() => setEditor({ day: cursor, groupId: groupFilter !== 'all' ? groupFilter : undefined })}>予定・タスクを追加<span className="orb"><Icon name="plus" size={20} stroke={2.4} /></span></button>
        <div style={{ height: 8 }} />
        <button className="side-link" onClick={() => setPanel('drafts')}><Icon name="memo" size={19} />未記入のメモ {drafts.length > 0 && <span className="count alert">{drafts.length}</span>}</button>
        <button className="side-link" onClick={() => setPanel('shopping')}><Icon name="cart" size={19} />買い物リスト <span className="count">{shoppingOpen.length || ''}</span></button>
        <button className="side-link" onClick={() => setPanel('checklists')}><Icon name="pack" size={19} />持ち物チェック</button>
        <button className="side-link" onClick={() => setPanel('notices')}><Icon name="bell" size={19} />お知らせ {unread > 0 && <span className="count alert">{unread}</span>}</button>
        <div className="side-section">グループ</div>
        <button className={'side-link' + (groupFilter === 'all' ? ' on' : '')} onClick={() => setGroupFilter('all')}><Icon name="calendar" size={19} />すべて表示</button>
        {state.groups.map(g => (
          <button key={g.id} className={'side-link' + (groupFilter === g.id ? ' on' : '')} onClick={() => setGroupFilter(g.id)}>
            <span className="dot" style={{ background: g.color }} />{g.name}<span className="count">{g.is_personal ? '' : `${g.members.length}人`}</span>
          </button>
        ))}
        <button className="side-link dim" onClick={() => setPanel('groups')}><Icon name="plus" size={19} />新しいグループ</button>
        {someday.length > 0 && (
          <>
            <div className="side-section">いつかやる（日付なし）</div>
            {someday.map(t => (
              <button key={t.id} className="side-link" onClick={() => setEditor({ task: t })}>
                <span className="dot" style={{ background: t.color || state.groups.find(g => g.id === t.group_id)?.color }} />{t.title}
              </button>
            ))}
          </>
        )}
        <div className="grow" />
        <div className="side-section">{me.name} さん</div>
        {currentGroup && <button className="side-link" onClick={() => setPanel('members')}><Icon name="users" size={19} />メンバー・共有設定</button>}
        <button className="side-link" onClick={() => setPanel('settings')}><Icon name="gear" size={19} />設定・他の端末で使う</button>
        <Scene />
      </aside>

      {/* ---------- メイン ---------- */}
      <main className="main">
        <div className="head">
        <div className="topbar">
          <div className="title"><span className="only-mobile" style={{ display: 'inline-flex' }}><Logo size={30} /></span>{groupTitle}</div>
          <button className="icon-btn only-mobile" onClick={() => setPanel('notices')} aria-label="お知らせ"><Icon name="bell" />{unread > 0 && <span className="badge">{unread}</span>}</button>
          <button className="icon-btn" onClick={() => (currentGroup ? setPanel('members') : setPanel('groups'))} aria-label="メンバー"><Icon name="users" /></button>
          <button className="icon-btn only-mobile" onClick={() => setPanel('settings')} aria-label="設定"><Icon name="gear" /></button>
          <button className="icon-btn green only-mobile" onClick={() => setPanel('groups')} aria-label="グループ切り替え"><Icon name="menu" stroke={2.4} /></button>
        </div>
        <div className="toolbar">
          <div className="seg">
            {(['day', 'week', 'month'] as View[]).map(v => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v.toUpperCase()}</button>
            ))}
          </div>
          <span className="period grow">{periodLabel(view, cursor)}
            {view === 'day' && todayList.length > 0 && <span className="small only-pc" style={{ marginLeft: 10, opacity: .7 }}>{todayList.filter(o => o.done).length}/{todayList.length} 完了</span>}
          </span>
          <button className="icon-btn" onClick={() => move(-1)} aria-label="前へ"><Icon name="left" size={20} /></button>
          <button className="btn small" onClick={() => setCursor(localToday())}>今日</button>
          <button className="icon-btn" onClick={() => move(1)} aria-label="次へ"><Icon name="right" size={20} /></button>
        </div>
        </div>
        <div className="content">
          {view === 'day' && cursor === today && someday.length > 0 && (
            <details className="only-mobile" style={{ padding: '8px 12px' }}>
              <summary className="small muted" style={{ padding: '4px' }}>いつかやる（日付なし） {someday.length}件</summary>
              <div className="todo-list" style={{ padding: '6px 0 0' }}>
                {someday.map(t => (
                  <button key={t.id} className="todo" onClick={() => setEditor({ task: t })}>
                    <span className="dot" style={{ background: t.color || state.groups.find(g => g.id === t.group_id)?.color }} />
                    <span className="grow">{t.title}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
          {view === 'day' && <DayView {...calProps} />}
          {view === 'week' && <WeekView {...calProps} />}
          {view === 'month' && <MonthView {...calProps} />}
        </div>

        {/* ---------- スマホ：下のボタン ---------- */}
        <nav className="bottombar">
          <button onClick={() => setPanel('drafts')}><span className="i"><Icon name="memo" /></span>未記入{drafts.length > 0 && <span className="badge">{drafts.length}</span>}</button>
          <button onClick={() => setPanel('shopping')}><span className="i"><Icon name="cart" /></span>買い物</button>
          <button className="capture-btn" onClick={openCapture} aria-label="ひとことメモ"><span className="i"><Icon name="plus" size={28} stroke={2.6} /></span>メモ</button>
          <button onClick={() => setPanel('checklists')}><span className="i"><Icon name="pack" /></span>持ち物</button>
          <button onClick={() => setEditor({ day: cursor, groupId: groupFilter !== 'all' ? groupFilter : undefined })}><span className="i"><Icon name="calendar" /></span>予定</button>
        </nav>
      </main>

      {/* ---------- ワンボタンメモ（スマホ）：常に置いておき、タップで即キーボード ---------- */}
      {captureOpen && <div className="capture-backdrop" onClick={() => { setCaptureOpen(false); captureRef.current?.blur(); }} />}
      <div className={'capture-sheet only-mobile' + (captureOpen ? ' open' : '')} aria-hidden={!captureOpen}>
        <div className="cap-title">忘れる前に、ひとことだけ</div>
        <input ref={captureRef} type="text" placeholder="例：小麦粉、田中さんに電話" value={capture} onChange={e => setCapture(e.target.value)} enterKeyHint="done"
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); saveCapture(capture.trim()); } }} />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => { const t = capture.trim(); setCaptureOpen(false); setCapture(''); setEditor({ day: cursor, title: t }); }}>いま詳しく書く</button>
          <div className="grow" />
          <button className="btn primary" onClick={() => saveCapture(capture.trim())}>とりあえず保存</button>
        </div>
      </div>

      {/* ---------- シート類 ---------- */}
      {editor && (
        <TaskEditor key={(editor.task?.id || 'new') + (editor.task?.updated_at || '')} state={state} init={editor}
          onClose={() => setEditor(null)}
          onRefresh={load}
          onSaved={async msg => {
            await load();
            if (msg) { setEditor(null); notify(msg); }
            else setEditor(e => (e?.task ? { ...e } : e));
          }} />
      )}
      {panel === 'drafts' && <DraftsPanel state={state} onClose={() => setPanel(null)} reload={load} onOpen={(t: Task) => { setPanel(null); setEditor({ task: t }); }} />}
      {panel === 'shopping' && <ShoppingPanel state={state} groupFilter={groupFilter} onClose={() => setPanel(null)} reload={load} onShoppingDone={afterShopping} notify={notify} />}
      {panel === 'checklists' && <ChecklistPanel state={state} onClose={() => setPanel(null)} reload={load} onOpenFull={c => { setPanel(null); setFullList(c); }} />}
      {panel === 'groups' && <GroupDrawer state={state} current={groupFilter} onClose={() => setPanel(null)} reload={load} onPick={id => { setGroupFilter(id); setPanel(id !== 'all' && !state.groups.find(g => g.id === id) ? 'members' : null); }} />}
      {panel === 'members' && currentGroup && <MembersPanel key={currentGroup.id} state={state} group={currentGroup} onClose={() => setPanel(null)} reload={load} notify={notify} onLeft={() => { setPanel(null); setGroupFilter('all'); load(); }} />}
      {panel === 'settings' && <SettingsPanel state={state} onClose={() => setPanel(null)} notify={notify} />}
      {panel === 'notices' && <NoticePanel state={state} onClose={() => { setPanel(null); load(); }} />}
      {brief && <TodayBrief state={state} today={today} onClose={() => setBrief(false)} />}
      {fullList && <FullChecklist list={state.checklists.find(c => c.id === fullList.id) || fullList} onClose={() => setFullList(null)} reload={load} />}

      {/* ---------- 付箋 ---------- */}
      <div className="stickies">
        {stickies.map(s => (
          <div key={s.key} className={'sticky ' + s.kind}>
            <button className="x" onClick={() => dismiss(s.key)} aria-label="閉じる">×</button>
            <div style={{ paddingRight: 16 }}><span className="sticky-ico"><Emoji char={s.kind === 'done' ? '🎉' : s.kind === 'created' ? '✨' : s.kind === 'draft' ? '📋' : '💬'} size={22} /></span><EmojiText text={s.body} /></div>
            {s.kind === 'done' && s.taskId && (
              <div className="emojis">
                {['👍', '❤️', '💪', '👏'].map(em => (
                  <button key={em} onClick={async () => {
                    await api('reactions', 'POST', { task_id: s.taskId, occ_date: s.occDate, emoji: em }).catch(() => {});
                    dismiss(s.key);
                    notify(`${em} を送りました`);
                  }} aria-label={em}><Emoji char={em} size={24} /></button>
                ))}
              </div>
            )}
            {(s.kind === 'created' || s.kind === 'draft') && s.taskId && (
              <button className="btn small" style={{ marginTop: 8 }} onClick={() => {
                const t = state.tasks.find(x => x.id === s.taskId);
                dismiss(s.key);
                if (!t) return;
                if (s.kind === 'draft') setEditor({ task: t });
                else { if (t.date) { setCursor(t.date); setView('day'); } setEditor({ task: t }); }
              }}>{s.kind === 'draft' ? '詳細を入力' : '詳細を見る'}</button>
            )}
          </div>
        ))}
      </div>

      {/* ---------- 時間のリマインド（大きく） ---------- */}
      {banner && (
        <div className="banner" onClick={() => setBanner(null)}>
          <div className="banner-card" onClick={e => e.stopPropagation()}>
            <div className="big"><Emoji char={banner.icon} size={46} /></div>
            <h2>{banner.title}</h2>
            <div className="muted">{banner.body}</div>
            <button className="btn primary block" style={{ marginTop: 18 }} onClick={() => { setBanner(null); if (banner.icon === '📋') setPanel('drafts'); }}>
              {banner.icon === '📋' ? '詳細を入力する' : 'OK'}
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast"><EmojiText text={toast} /></div>}
    </div>
  );
}
