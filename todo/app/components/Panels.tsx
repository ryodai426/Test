'use client';
import { useEffect, useState } from 'react';
import { WEEK_LABELS } from '@/lib/time';
import Icon from './Icon';
import { sw, api, fmtJpDate, hhmm, localDateOf, localToday, PALETTE, type Checklist, type Group, type State, type Task } from '../lib';

function Sheet({ title, icon, onClose, children, foot, side = true }: { title: string; icon?: string; onClose: () => void; children: React.ReactNode; foot?: React.ReactNode; side?: boolean }) {
  return (
    <div className={'overlay' + (side ? ' side' : '')} onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{icon && <Icon name={icon} />}{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる"><Icon name="close" size={20} /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {foot && <div className="sheet-foot">{foot}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 未記入メモ

export function DraftsPanel({ state, onClose, onOpen, reload }: { state: State; onClose: () => void; onOpen: (t: Task) => void; reload: () => void }) {
  const drafts = state.tasks.filter(t => t.status === 'draft' && t.user_id === state.me!.id)
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  return (
    <Sheet title="未記入のメモ" icon="memo" onClose={onClose}>
      <div className="small muted" style={{ marginTop: 10 }}>🔒 自分にしか見えません。押すと詳細を入力できます。</div>
      {drafts.length === 0 && <div className="empty">未記入のメモはありません 🎉</div>}
      {drafts.map(t => (
        <div key={t.id} className="row">
          <button className="draft grow" onClick={() => onOpen(t)}>
            <div className="grow">
              <div className="time">{localDateOf(t.captured_at) === localToday() ? '今日' : fmtJpDate(localDateOf(t.captured_at))} {hhmm(t.captured_at)} に記録</div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{t.title || <span className="muted">（ひとことなし）</span>}</div>
            </div>
            <span className="muted small">詳細を入力 ›</span>
          </button>
          <button className="icon-btn" style={{ marginTop: 10 }} aria-label="削除" onClick={async () => { await api(`tasks/${t.id}`, 'DELETE'); reload(); }}><Icon name="trash" size={19} /></button>
        </div>
      ))}
    </Sheet>
  );
}

// ---------------------------------------------------------------- 買い物リスト

export function ShoppingPanel({ state, groupFilter, onClose, reload, onShoppingDone, notify }: {
  state: State; groupFilter: string; onClose: () => void; reload: () => Promise<void> | void;
  onShoppingDone: () => void; notify: (m: string) => void;
}) {
  const groups = new Map(state.groups.map(g => [g.id, g]));
  const lists = state.tasks.filter(t => t.kind === 'shopping' && t.status === 'ready' && (groupFilter === 'all' || t.group_id === groupFilter));
  const open = lists.filter(t => !t.done_at);
  const done = lists.filter(t => t.done_at).slice(0, 5);
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState(groupFilter !== 'all' ? groupFilter : state.groups.find(g => g.is_personal)!.id);
  const [texts, setTexts] = useState<Record<string, string>>({});

  async function toggle(id: string, checked: boolean) {
    const r = await api<{ completed: boolean }>(`items/${id}`, 'PATCH', { checked });
    await reload();
    if (r.completed) { notify('全部そろいました！ 買い物完了 🎉'); onShoppingDone(); }
  }
  async function add(taskId: string) {
    const labels = (texts[taskId] || '').split(/[、,\n]/).map(s => s.trim()).filter(Boolean);
    if (!labels.length) return;
    setTexts(x => ({ ...x, [taskId]: '' }));
    await api(`tasks/${taskId}/items`, 'POST', { labels });
    reload();
  }
  async function create() {
    if (!newName.trim()) return;
    await api('tasks', 'POST', { title: newName, kind: 'shopping', group_id: newGroup, date: null });
    setNewName('');
    reload();
  }

  const renderList = (t: Task) => {
    const g = groups.get(t.group_id);
    const items = state.items.filter(i => i.task_id === t.id);
    const left = items.filter(i => !i.checked).length;
    return (
      <div key={t.id} className="card" style={{ borderLeft: `4px solid ${t.color || g?.color}` }}>
        <div className="row">
          <h4>{t.title}</h4>
          <span className="small muted">{t.done_at ? '完了' : `残り${left}`}{g && !g.is_personal ? ` ・${g.name}` : ''}</span>
        </div>
        {t.date && <div className="small muted">{fmtJpDate(t.date)}{t.time ? ` ${t.time}` : ''}</div>}
        <div style={{ marginTop: 6 }}>
          {[...items].sort((a, b) => Number(a.checked) - Number(b.checked) || a.position - b.position).map(i => (
            <div key={i.id} className={'li' + (i.checked ? ' on' : '')}>
              <button className={'box' + (i.checked ? ' on' : '')} onClick={() => toggle(i.id, !i.checked)}>{i.checked ? '✓' : ''}</button>
              <span className="grow" onClick={() => toggle(i.id, !i.checked)}>{i.label}</span>
              <button className="del" onClick={async () => { await api(`items/${i.id}`, 'DELETE'); reload(); }} aria-label="削除">×</button>
            </div>
          ))}
        </div>
        {!t.done_at && (
          <div className="row" style={{ marginTop: 6 }}>
            <input type="text" placeholder="品目を追加（読点で区切って複数）" value={texts[t.id] || ''}
              onChange={e => setTexts(x => ({ ...x, [t.id]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(t.id); }} />
            <button className="btn small" onClick={() => add(t.id)}>追加</button>
          </div>
        )}
        {t.done_at && <button className="btn small" style={{ marginTop: 8 }} onClick={async () => { await api(`tasks/${t.id}`, 'DELETE'); reload(); }}>このリストを消す</button>}
      </div>
    );
  };

  return (
    <Sheet title="買い物リスト" icon="cart" onClose={onClose}>
      {open.length === 0 && <div className="empty">買い物リストはありません</div>}
      {open.map(renderList)}
      <div className="card soft">
        <div className="small" style={{ fontWeight: 700, marginBottom: 8 }}>＋ 新しい買い物リスト</div>
        <input type="text" placeholder="例：今日の買い物、週末の買い物" value={newName} onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) create(); }} />
        <div className="row wrap" style={{ marginTop: 8 }}>
          {state.groups.map(g => (
            <button key={g.id} className={'chip' + (g.id === newGroup ? ' on' : '')} onClick={() => setNewGroup(g.id)}>
              <span className="dot" style={{ background: g.color, marginRight: 6 }} />{g.name}
            </button>
          ))}
        </div>
        <button className="btn primary block" style={{ marginTop: 10 }} onClick={create} disabled={!newName.trim()}>作成</button>
      </div>
      {done.length > 0 && <div className="label">最近おわった買い物</div>}
      {done.map(renderList)}
    </Sheet>
  );
}

// ---------------------------------------------------------------- 持ち物チェックリスト

export function checklistDue(c: Checklist, now = new Date()): boolean {
  if (c.trigger !== 'time' || !c.show_at) return false;
  if (!c.weekdays.includes(now.getDay())) return false;
  const [h, m] = c.show_at.split(':').map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  // 設定時刻から2時間のあいだにアプリを開いたら表示する
  return mins >= h * 60 + m && mins < h * 60 + m + 120;
}

export async function toggleCheck(itemId: string, checked: boolean) {
  await api(`checklist-items/${itemId}/check`, 'POST', { day: localToday(), checked });
}

export function FullChecklist({ list, onClose, reload }: { list: Checklist; onClose: () => void; reload: () => Promise<void> | void }) {
  const [items, setItems] = useState(list.items);
  useEffect(() => setItems(list.items), [list]);
  const all = items.length > 0 && items.every(i => i.checked);
  async function flip(id: string) {
    const next = items.map(i => (i.id === id ? { ...i, checked: !i.checked } : i));
    setItems(next);
    await toggleCheck(id, !!next.find(i => i.id === id)?.checked);
    reload();
  }
  return (
    <div className="fullcheck">
      <div className="row">
        <div className="grow eyebrow">Before you go</div>
        <button className="icon-btn" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button>
      </div>
      <h2>{list.name}</h2>
      <div className="sub">指差し確認しながらタップ</div>
      <div className="progress">{items.filter(i => i.checked).length} / {items.length}</div>
      <div className="items">
        {items.map(i => (
          <button key={i.id} className={'it' + (i.checked ? ' on' : '')} onClick={() => flip(i.id)}>
            <span className={'box' + (i.checked ? ' on' : '')}>{i.checked ? '✓' : ''}</span>{i.label}
          </button>
        ))}
        {items.length === 0 && <div className="empty" style={{ color: 'rgba(255,255,255,.7)' }}>項目がありません。「持ち物」から追加できます。</div>}
      </div>
      <button className="btn primary block" style={{ maxWidth: 520, alignSelf: 'center' }} onClick={onClose}>
        {all ? '全部OK！ いってらっしゃい' : 'とじる'}
      </button>
    </div>
  );
}

function ChecklistEditor({ list, onDone }: { list?: Checklist; onDone: () => void }) {
  const [name, setName] = useState(list?.name || '');
  const [trigger, setTrigger] = useState<Checklist['trigger']>(list?.trigger || 'time');
  const [showAt, setShowAt] = useState(list?.show_at || '07:00');
  const [weekdays, setWeekdays] = useState<number[]>(list?.weekdays || [1, 2, 3, 4, 5]);
  const [items, setItems] = useState<{ id?: string; label: string }[]>(list?.items.map(i => ({ id: i.id, label: i.label })) || [{ label: '' }]);
  const [err, setErr] = useState('');

  async function save() {
    if (!name.trim()) { setErr('名前を入力してください'); return; }
    const body = { name, trigger, show_at: trigger === 'time' ? showAt : null, weekdays, items: items.filter(i => i.label.trim()) };
    if (list) await api(`checklists/${list.id}`, 'PATCH', body);
    else await api('checklists', 'POST', body);
    onDone();
  }

  return (
    <div className="card">
      <div className="label" style={{ marginTop: 0 }}>名前</div>
      <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="例：家を出る時、会議の日" />
      <div className="label">いつ表示する？</div>
      <div className="row wrap">
        <button className={'chip' + (trigger === 'time' ? ' on' : '')} onClick={() => setTrigger('time')}>⏰ 決まった時間</button>
        <button className={'chip' + (trigger === 'after_shopping' ? ' on' : '')} onClick={() => setTrigger('after_shopping')}>🛒 買い物が終わったら</button>
        <button className={'chip' + (trigger === 'manual' ? ' on' : '')} onClick={() => setTrigger('manual')}>自分で開く</button>
      </div>
      {trigger === 'time' && (
        <>
          <div className="row" style={{ marginTop: 10 }}>
            <input type="time" value={showAt} onChange={e => setShowAt(e.target.value)} style={{ width: 140 }} />
            <span className="small muted">に通知して、開いたら全画面で表示</span>
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            {[1, 2, 3, 4, 5, 6, 0].map(w => (
              <button key={w} className={'chip' + (weekdays.includes(w) ? ' on' : '')} style={{ width: 40, padding: '7px 0' }}
                onClick={() => setWeekdays(ws => (ws.includes(w) ? ws.filter(x => x !== w) : [...ws, w]))}>{WEEK_LABELS[w]}</button>
            ))}
          </div>
        </>
      )}
      {trigger === 'after_shopping' && <div className="small muted" style={{ marginTop: 8 }}>買い物リストを全部チェックした瞬間に表示します（傘・買った物の置き忘れ防止）</div>}
      <div className="label">チェック項目</div>
      {items.map((it, i) => (
        <div key={i} className="row" style={{ marginBottom: 6 }}>
          <input type="text" value={it.label} placeholder="例：財布" onChange={e => setItems(xs => xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) setItems(xs => [...xs, { label: '' }]); }} />
          <button className="icon-btn" onClick={() => setItems(xs => xs.filter((_, j) => j !== i))} aria-label="削除">×</button>
        </div>
      ))}
      <button className="btn small" onClick={() => setItems(xs => [...xs, { label: '' }])}>＋ 項目を追加</button>
      {err && <div className="err">{err}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        {list && <button className="btn danger small" onClick={async () => { if (confirm(`「${list.name}」を削除しますか？`)) { await api(`checklists/${list.id}`, 'DELETE'); onDone(); } }}>削除</button>}
        <div className="grow" />
        <button className="btn small" onClick={onDone}>キャンセル</button>
        <button className="btn primary small" onClick={save}>保存</button>
      </div>
    </div>
  );
}

export function ChecklistPanel({ state, onClose, reload, onOpenFull }: { state: State; onClose: () => void; reload: () => Promise<void> | void; onOpenFull: (c: Checklist) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const triggerText = (c: Checklist) =>
    c.trigger === 'time' ? `${c.show_at} に表示（${c.weekdays.length === 7 ? '毎日' : [1, 2, 3, 4, 5, 6, 0].filter(w => c.weekdays.includes(w)).map(w => WEEK_LABELS[w]).join('')}）`
      : c.trigger === 'after_shopping' ? '買い物が終わったら表示' : '自分で開く';
  return (
    <Sheet title="持ち物チェックリスト" icon="pack" onClose={onClose}>
      <div className="small muted" style={{ marginTop: 10 }}>チェックは毎日リセットされます。</div>
      {state.checklists.map(c => editing === c.id ? (
        <ChecklistEditor key={c.id} list={c} onDone={() => { setEditing(null); reload(); }} />
      ) : (
        <div key={c.id} className="card">
          <div className="row">
            <h4>{c.name}</h4>
            <button className="btn small" onClick={() => onOpenFull(c)}>開く</button>
            <button className="btn small" onClick={() => setEditing(c.id)}>編集</button>
          </div>
          <div className="small muted" style={{ marginBottom: 4 }}>{triggerText(c)}</div>
          {c.items.map(i => (
            <div key={i.id} className={'li' + (i.checked ? ' on' : '')}>
              <button className={'box' + (i.checked ? ' on' : '')} onClick={async () => { await toggleCheck(i.id, !i.checked); reload(); }}>{i.checked ? '✓' : ''}</button>
              <span className="grow">{i.label}</span>
            </div>
          ))}
        </div>
      ))}
      {editing === 'new' ? <ChecklistEditor onDone={() => { setEditing(null); reload(); }} /> : (
        <button className="btn block" style={{ marginTop: 14 }} onClick={() => setEditing('new')}>＋ 新しいチェックリスト</button>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- グループ切り替え

export function GroupDrawer({ state, current, onPick, onClose, reload }: {
  state: State; current: string; onPick: (id: string) => void; onClose: () => void; reload: () => Promise<void> | void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[1]);
  async function create() {
    if (!name.trim()) return;
    const g = await api<{ id: string }>('groups', 'POST', { name, color });
    await reload();
    onPick(g.id);
  }
  return (
    <Sheet title="グループ" icon="calendar" onClose={onClose}>
      <div style={{ marginTop: 8 }}>
        <button className={'side-link' + (current === 'all' ? ' on' : '')} onClick={() => onPick('all')}><Icon name="calendar" size={19} />すべて表示 <span className="count">色分けして重ねる</span></button>
        {state.groups.map(g => (
          <button key={g.id} className={'side-link' + (current === g.id ? ' on' : '')} onClick={() => onPick(g.id)}>
            <span className="dot" style={{ background: g.color }} />{g.name}
            <span className="count">{g.is_personal ? '自分だけ' : `${g.members.length}人`}</span>
          </button>
        ))}
      </div>
      <div className="hr" />
      {creating ? (
        <div>
          <input type="text" placeholder="グループ名（例：家族、営業チーム）" value={name} onChange={e => setName(e.target.value)} autoFocus />
          <div className="row" style={{ gap: 10, marginTop: 10 }}>
            {PALETTE.map(c => <button key={c} className={'swatch' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} />)}
          </div>
          <button className="btn primary block" style={{ marginTop: 12 }} onClick={create} disabled={!name.trim()}>作成して招待リンクを出す</button>
        </div>
      ) : (
        <button className="btn block" onClick={() => setCreating(true)}>＋ 新しいグループを作成</button>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- メンバー・共有設定

export function MembersPanel({ state, group, onClose, reload, notify, onLeft }: {
  state: State; group: Group; onClose: () => void; reload: () => Promise<void> | void; notify: (m: string) => void; onLeft: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [desc, setDesc] = useState(group.description);
  const inviteUrl = group.invite_token ? `${location.origin}/?join=${group.invite_token}` : '';
  async function patch(b: Record<string, unknown>) {
    await api(`groups/${group.id}`, 'PATCH', b);
    reload();
  }
  async function copy() {
    try {
      if (navigator.share && /iPhone|Android/.test(navigator.userAgent)) await navigator.share({ title: `${group.name}に招待`, url: inviteUrl });
      else { await navigator.clipboard.writeText(inviteUrl); notify('招待リンクをコピーしました'); }
    } catch { /* キャンセル */ }
  }
  return (
    <Sheet title="メンバー・共有設定" icon="users" onClose={onClose}>
      <div className="label">現在のグループ</div>
      <div className="row"><span className="dot" style={{ background: group.color }} /><b>{group.name}</b></div>
      {!group.is_personal && (
        <>
          <div className="label">メンバー（{group.members.length}人）</div>
          {group.members.map(m => <div key={m.id} className="li"><span className="grow">{m.name}{m.id === state.me!.id ? '（あなた）' : ''}</span></div>)}
          <div className="label">メンバーを招待</div>
          <button className="btn primary block" onClick={copy}><Icon name="link" size={18} />招待リンクを送る／コピー</button>
          <div className="small muted" style={{ marginTop: 6, wordBreak: 'break-all' }}>{inviteUrl}</div>
        </>
      )}
      <div className="label">グループ名</div>
      <input type="text" value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== group.name && patch({ name })} />
      {!group.is_personal && (
        <>
          <div className="label">説明</div>
          <input type="text" value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => desc !== group.description && patch({ description: desc })} placeholder="任意" />
        </>
      )}
      <div className="label">グループの色</div>
      <div className="row" style={{ gap: 10 }}>
        {PALETTE.map(c => <button key={c} className={'swatch' + (group.color === c ? ' on' : '')} style={{ background: c }} onClick={() => patch({ color: c })} />)}
      </div>
      {!group.is_personal && (
        <>
          <div className="label">共有設定（グループ全員に反映）</div>
          <label className="li"><input type="checkbox" checked={group.notify_create} onChange={e => patch({ notify_create: e.target.checked })} /><span className="grow">タスク作成を付箋で知らせる</span></label>
          <label className="li"><input type="checkbox" checked={group.notify_done} onChange={e => patch({ notify_done: e.target.checked })} /><span className="grow">タスク完了を付箋で知らせる</span></label>
          <div className="hr" />
          <button className="btn danger block" onClick={async () => {
            if (!confirm(`「${group.name}」から抜けますか？`)) return;
            await api(`groups/${group.id}/leave`, 'POST');
            onLeft();
          }}>このグループから抜ける</button>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- 設定（通知・端末）

function urlB64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export async function currentPushSub(): Promise<PushSubscription | null> {
  const c = sw();
  if (!c || !('PushManager' in window)) return null;
  const reg = await c.getRegistration();
  return (await reg?.pushManager.getSubscription()) || null;
}

export function SettingsPanel({ state, onClose, notify }: { state: State; onClose: () => void; notify: (m: string) => void }) {
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [perm, setPerm] = useState<string>(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const [code, setCode] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [devices, setDevices] = useState<{ device: string; last_used_at: string }[]>([]);
  const standalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone);
  const ios = typeof navigator !== 'undefined' && /iPhone|iPad/.test(navigator.userAgent);
  const supported = typeof window !== 'undefined' && 'PushManager' in window && !!sw() && !!state.pushKey;

  useEffect(() => { currentPushSub().then(setSub); api('devices').then(setDevices).catch(() => {}); }, []);
  useEffect(() => {
    if (!left) return;
    const id = setTimeout(() => setLeft(l => (l <= 1 ? (setCode(null), 0) : l - 1)), 1000);
    return () => clearTimeout(id);
  }, [left]);

  async function enablePush() {
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== 'granted') { notify('通知が許可されませんでした'); return; }
      if (!state.pushKey) { notify('サーバーの通知設定（VAPID）がまだです'); return; }
      const reg = await sw()!.ready;
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(state.pushKey) });
      await api('push/subscribe', 'POST', { subscription: s.toJSON() });
      setSub(s);
      notify('この端末で通知を受け取ります');
    } catch (e: any) {
      notify('通知をオンにできませんでした：' + (e.message || e));
    }
  }
  async function disablePush() {
    if (!sub) return;
    await api('push/unsubscribe', 'POST', { endpoint: sub.endpoint });
    await sub.unsubscribe();
    setSub(null);
  }
  async function issue() {
    const r = await api<{ code: string; expiresInSec: number }>('auth/link-code', 'POST');
    setCode(r.code);
    setLeft(r.expiresInSec);
  }

  return (
    <Sheet title="設定" icon="gear" onClose={onClose}>
      <div className="label">ログイン中</div>
      <div><b>{state.me!.name}</b> さん</div>

      <div className="label">この端末以外でも使う（スマホ ⇄ 会社のPC）</div>
      <div className="small muted" style={{ marginBottom: 8 }}>もう1台の端末でこのアプリのURLを開き、「コードでログイン」に下の6桁を入力してください。同じ予定・メモがどちらからでも見えて、入れられます。</div>
      {code ? (
        <>
          <div className="code-big">{code}</div>
          <div className="small muted" style={{ textAlign: 'center', marginTop: 6 }}>あと {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} 有効・1回だけ使えます</div>
        </>
      ) : <button className="btn primary block" onClick={issue}>6桁のコードを出す</button>}
      {devices.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {devices.map((d, i) => <div key={i} className="li small"><span className="grow">💻 {d.device}</span><span className="muted">{fmtJpDate(localDateOf(d.last_used_at), false)} 最終利用</span></div>)}
        </div>
      )}

      <div className="label">この端末の通知</div>
      {!supported ? (
        <div className="small muted">{!state.pushKey ? 'プッシュ通知はまだ使えません（サーバーの通知設定が必要）。アプリを開いている間は、時間になると画面に大きく表示します。' : ios && !standalone ? 'iPhoneでは、Safariの共有ボタン →「ホーム画面に追加」してから開くと通知を受け取れます。' : 'このブラウザはプッシュ通知に対応していません。アプリを開いている間は画面内でお知らせします。'}</div>
      ) : sub ? (
        <div className="row">
          <span className="grow small">🔔 オン（この端末に届きます）</span>
          <button className="btn small" onClick={async () => { const r = await api('push/test', 'POST'); notify(r.sent ? 'テスト通知を送りました' : '送れませんでした'); }}>テスト</button>
          <button className="btn small" onClick={disablePush}>オフ</button>
        </div>
      ) : (
        <>
          <button className="btn primary block" onClick={enablePush} disabled={perm === 'denied'}>🔔 この端末で通知を受け取る</button>
          {perm === 'denied' && <div className="small err">ブラウザの設定で通知がブロックされています。サイトの設定から許可してください。</div>}
        </>
      )}
      <div className="small muted" style={{ marginTop: 8 }}>スマホとPCの両方でオンにすると、両方に届きます。</div>

      <div className="label">キーボード操作（PC）</div>
      <div className="small muted" style={{ lineHeight: 2 }}>
        <kbd>N</kbd> ひとことメモ　<kbd>A</kbd> 予定を追加　<kbd>T</kbd> 今日　<kbd>D</kbd>/<kbd>W</kbd>/<kbd>M</kbd> 日・週・月　<kbd>←</kbd><kbd>→</kbd> 前後へ
      </div>

      <div className="hr" />
      <button className="btn danger block" onClick={async () => {
        if (!confirm('この端末からログアウトしますか？（もう一度入るには、他の端末でコードを出す必要があります）')) return;
        await api('auth/logout', 'POST');
        location.reload();
      }}>この端末からログアウト</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- お知らせ履歴

export function NoticePanel({ state, onClose }: { state: State; onClose: () => void }) {
  useEffect(() => { api('notifications/read', 'POST', {}).catch(() => {}); }, []);
  return (
    <Sheet title="お知らせ" icon="bell" onClose={onClose}>
      {state.notifications.length === 0 && <div className="empty">お知らせはまだありません</div>}
      {state.notifications.map(n => (
        <div key={n.id} className={'notice' + (n.read_at ? '' : ' unread')}>
          <div>{n.kind === 'done' ? '🎉 ' : n.kind === 'created' ? '✨ ' : '💬 '}{n.body}</div>
          <div className="small muted">{fmtJpDate(localDateOf(n.created_at), false)} {hhmm(n.created_at)}</div>
        </div>
      ))}
    </Sheet>
  );
}
