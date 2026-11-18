'use client';
import { useEffect, useState } from 'react';
import { WEEK_LABELS } from '@/lib/time';
import Icon, { Scene } from './Icon';
import { Board, Note, PAPERS, TAPES } from './Board';
import { act, isTmp, tmpId, P } from '../store';
import { confirmDelete, hasSkippedConfirms, resetSkippedConfirms } from '../confirm';
import Emoji, { EmojiText } from './Emoji';
import { sw, isFor, api, fmtJpDate, hhmm, localDateOf, localToday, PALETTE, type Checklist, type Group, type State, type Task } from '../lib';

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

// ---------------------------------------------------------------- リスト（持ち物チェックなど）

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
    const checked = !!next.find(i => i.id === id)?.checked;
    act(P.setCheck(id, checked), () => toggleCheck(id, checked));
  }
  return (
    <div className="fullcheck">
      <div className="row">
        <div className="grow eyebrow">出発前のチェック</div>
        <button className="icon-btn" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button>
      </div>
      <h2>{list.name}</h2>
      <div className="progress"><span>{items.filter(i => i.checked).length} / {items.length}</span></div>
      <div className="items">
        {items.map(i => (
          <button key={i.id} className={'it' + (i.checked ? ' on' : '')} onClick={() => flip(i.id)}>
            <span className={'box' + (i.checked ? ' on' : '')}>{i.checked && <Icon name="check" size={18} stroke={2.6} />}</span>{i.label}
          </button>
        ))}
        {items.length === 0 && <div className="empty" style={{ color: 'var(--ink)' }}>項目がありません。「リスト」から追加できます。</div>}
      </div>
      <div className="foot">
        <button className="btn white block big" onClick={onClose}>
          {all ? '全部OK！ いってらっしゃい' : 'とじる'}<span className="orb"><Icon name={all ? 'right' : 'close'} size={18} stroke={2.4} /></span>
        </button>
      </div>
      <Scene onGreen />
    </div>
  );
}

function ChecklistEditor({ list, onDone }: { list?: Checklist; onDone: () => void }) {
  const [name, setName] = useState(list?.name || '');
  // 「買い物が終わったら」は買い物リストをなくしたので選べない（前に選んでいたリストは「自分で開く」）
  const [trigger, setTrigger] = useState<Checklist['trigger']>(list ? (list.trigger === 'after_shopping' ? 'manual' : list.trigger) : 'time');
  const [showAt, setShowAt] = useState(list?.show_at || '07:00');
  const [weekdays, setWeekdays] = useState<number[]>(list?.weekdays || [1, 2, 3, 4, 5]);
  const [items, setItems] = useState<{ id?: string; label: string }[]>(list?.items.map(i => ({ id: i.id, label: i.label })) || [{ label: '' }]);
  const [err, setErr] = useState('');

  function save() {
    if (!name.trim()) { setErr('名前を入力してください'); return; }
    const body = { name, trigger, show_at: trigger === 'time' ? showAt : null, weekdays, items: items.filter(i => i.label.trim()) };
    const view: Checklist = {
      id: list?.id || tmpId(), name, trigger, show_at: body.show_at, weekdays, position: list?.position ?? 99,
      items: body.items.map(i => ({ id: i.id || tmpId(), label: i.label, checked: list?.items.find(x => x.id === i.id)?.checked || false })),
    };
    onDone();
    act(P.upsertChecklist(view), () => (list ? api(`checklists/${list.id}`, 'PATCH', body) : api('checklists', 'POST', body)));
  }

  return (
    <div className="note-editor">
      <div className="label" style={{ marginTop: 0 }}>名前</div>
      <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="例：家を出る時、会議の日" />
      <div className="label">いつ表示する？</div>
      <div className="row wrap">
        <button className={'chip' + (trigger === 'time' ? ' on' : '')} onClick={() => setTrigger('time')}><Emoji char="⏰" size={18} />&nbsp;決まった時間</button>
        <button className={'chip' + (trigger === 'manual' ? ' on' : '')} onClick={() => setTrigger('manual')}>自分で開く</button>
      </div>
      {trigger === 'time' && (
        <>
          <div className="row" style={{ marginTop: 10 }}>
            <input type="time" value={showAt} onChange={e => setShowAt(e.target.value)} style={{ width: 140 }} />
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            {[1, 2, 3, 4, 5, 6, 0].map(w => (
              <button key={w} className={'chip' + (weekdays.includes(w) ? ' on' : '')} style={{ width: 40, padding: '7px 0' }}
                onClick={() => setWeekdays(ws => (ws.includes(w) ? ws.filter(x => x !== w) : [...ws, w]))}>{WEEK_LABELS[w]}</button>
            ))}
          </div>
        </>
      )}
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
        {list && <button className="btn danger small" onClick={async () => { if (await confirmDelete(`「${list.name}」を削除しますか？`, 'checklist')) { onDone(); act(P.removeChecklist(list.id), () => api(`checklists/${list.id}`, 'DELETE')); } }}>削除</button>}
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
    c.trigger === 'time' ? `${c.show_at}・${c.weekdays.length === 7 ? '毎日' : [1, 2, 3, 4, 5, 6, 0].filter(w => c.weekdays.includes(w)).map(w => WEEK_LABELS[w]).join('')}`
      : '';
  return (
    <Board label="リスト" eyebrow="" title="リスト" onClose={onClose}
      sum={`${state.checklists.length}枚`}>
      <div className="brief-board board-wide">
        {state.checklists.map((c, i) => {
          const done = c.items.filter(x => x.checked).length;
          return (
            <Note key={c.id} i={i} paper={PAPERS[i % PAPERS.length]} tape={TAPES[i % TAPES.length]} className="check-note">
              {editing === c.id ? (
                <ChecklistEditor list={c} onDone={() => { setEditing(null); reload(); }} />
              ) : (
                <>
                  <div className="row">
                    <h4 className="note-title grow">{c.name}</h4>
                    <span className="note-count">{done}/{c.items.length}</span>
                    <button className="note-del" aria-label={`「${c.name}」を削除`} title="削除" onClick={async () => {
                      if (isTmp(c.id) || !(await confirmDelete(`「${c.name}」を削除しますか？`, 'checklist'))) return;
                      act(P.removeChecklist(c.id), () => api(`checklists/${c.id}`, 'DELETE'));
                    }}><Icon name="trash" size={17} /></button>
                  </div>
                  {triggerText(c) && <div className="small muted">{triggerText(c)}</div>}
                  <div className="note-items">
                    {c.items.map(it => (
                      <div key={it.id} className={'li' + (it.checked ? ' on' : '')} role="checkbox" aria-checked={it.checked} tabIndex={0}
                        onClick={() => { if (!isTmp(it.id)) act(P.setCheck(it.id, !it.checked), () => toggleCheck(it.id, !it.checked)); }}>
                        <span className={'box' + (it.checked ? ' on' : '')}>{it.checked && <Icon name="check" size={15} stroke={2.6} />}</span>
                        <span className="grow">{it.label}</span>
                      </div>
                    ))}
                    {c.items.length === 0 && <div className="small muted">項目なし</div>}
                  </div>
                  <div className="row note-actions">
                    <button className="btn primary small" onClick={() => onOpenFull(c)}><Icon name="pack" size={16} />全画面でチェック</button>
                    <button className="btn small" onClick={() => setEditing(c.id)}>編集</button>
                  </div>
                </>
              )}
            </Note>
          );
        })}
        <Note i={state.checklists.length} paper="rgba(255,255,255,.55)" tape="var(--yellow)" className="note-add check-note">
          {editing === 'new' ? <ChecklistEditor onDone={() => { setEditing(null); reload(); }} /> : (
            <button className="note-add-btn" onClick={() => setEditing('new')}>＋ 新しいチェックリスト</button>
          )}
        </Note>
      </div>
    </Board>
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
          <input type="text" placeholder="例：家族、営業チーム" value={name} onChange={e => setName(e.target.value)} autoFocus />
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
          <div className="label">メンバー・{group.members.length}人</div>
          {group.members.map(m => <div key={m.id} className="li"><span className="grow">{m.name}{m.id === state.me!.id ? '・自分' : ''}</span></div>)}
          <div className="label">メンバーを招待</div>
          <button className="btn primary block" onClick={copy}><Icon name="link" size={18} />招待リンクを送る／コピー</button>
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
      <KindsEditor state={state} group={group} reload={reload} notify={notify} />
      <div className="label">グループの色</div>
      <div className="row" style={{ gap: 10 }}>
        {PALETTE.map(c => <button key={c} className={'swatch' + (group.color === c ? ' on' : '')} style={{ background: c }} onClick={() => patch({ color: c })} />)}
      </div>
      {!group.is_personal && (
        <>
          <div className="label">共有設定</div>
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

function KindsEditor({ state, group, reload, notify }: { state: State; group: Group; reload: () => Promise<void> | void; notify: (m: string) => void }) {
  const kinds = (state.kinds || []).filter(k => k.group_id === group.id);
  const [name, setName] = useState('');
  async function add() {
    if (!name.trim()) return;
    try {
      await api(`groups/${group.id}/kinds`, 'POST', { name: name.trim() });
      setName('');
      reload();
    } catch (e: any) { notify(e.message); }
  }
  return (
    <>
      <div className="label">タスクの種類</div>
      <div className="row wrap">
        {kinds.map(k => (
          <span key={k.id} className="chip">
            {k.name}
            <button className="kind-x" aria-label={`「${k.name}」を削除`} onClick={async () => {
              if (!(await confirmDelete(`種類「${k.name}」を削除しますか？\nこの種類の予定は「一般」になります。`, 'kind'))) return;
              await api(`kinds/${k.id}`, 'DELETE');
              reload();
            }}><Icon name="close" size={14} stroke={2.4} /></button>
          </span>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input type="text" placeholder="例：営業訪問、通院、塾" value={name} maxLength={20} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }} />
        <button className="btn small primary" onClick={add} disabled={!name.trim()}>追加</button>
      </div>
    </>
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
  try {
    const reg = await c.getRegistration();
    return (await reg?.pushManager.getSubscription()) || null;
  } catch {
    return null; // 埋め込み表示など、Service Worker が使えない場所
  }
}

export function SettingsPanel({ state, onClose, notify, reload, onReview }: {
  state: State; onClose: () => void; notify: (m: string) => void; reload: () => Promise<void> | void; onReview: () => void;
}) {
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

  const [pushErr, setPushErr] = useState('');
  const [skippedConfirms, setSkippedConfirms] = useState(false);
  useEffect(() => setSkippedConfirms(hasSkippedConfirms()), []);
  const [pushBusy, setPushBusy] = useState(false);
  async function enablePush() {
    setPushErr('');
    setPushBusy(true);
    // どこで失敗したか分かるように、手順ごとに説明を変える
    let step = '通知の許可';
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== 'granted') { setPushErr('通知が許可されませんでした'); return; }
      if (!state.pushKey) { setPushErr('サーバーの通知の鍵がまだ設定されていません'); return; }
      step = 'アプリの準備';
      const container = sw();
      if (!container) throw new Error('Service Worker が使えません');
      if (!(await container.getRegistration())) await container.register('/sw.js');
      const reg = await Promise.race([
        container.ready,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('時間切れ。アプリを閉じて開き直してください')), 10000)),
      ]);
      step = '端末の通知の登録';
      const key = urlB64ToUint8Array(state.pushKey);
      let s: PushSubscription;
      try {
        s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      } catch (e) {
        // 前に別の鍵で登録した名残があると失敗するので、消してからもう一度
        const old = await reg.pushManager.getSubscription();
        if (!old) throw e;
        await old.unsubscribe();
        s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      step = 'サーバーへの保存';
      await api('push/subscribe', 'POST', { subscription: s.toJSON() });
      setSub(s);
      notify('この端末で通知を受け取ります');
    } catch (e: any) {
      setPushErr(`${step}で失敗しました：${e?.message || e}`);
    } finally {
      setPushBusy(false);
    }
  }
  async function testPush() {
    try {
      const r = await api<{ sent: number; devices: number; error: string | null }>('push/test', 'POST');
      if (r.sent) { notify('テスト通知を送りました'); setPushErr(''); }
      else setPushErr(r.devices ? `送れませんでした：${r.error || '原因不明'}` : 'この端末の登録がサーバーにありません。オフにしてから、もう一度オンにしてください');
    } catch (e: any) {
      setPushErr(e?.message || String(e));
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

      <div className="label">今日の振り返り</div>
      <button className="btn primary block" onClick={onReview}>今日の振り返りを見る</button>
      <label className="li" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={!state.me!.review_skip} onChange={async e => {
          await api('me', 'PATCH', { review_skip: !e.target.checked });
          notify(e.target.checked ? '夕方に振り返りを聞きます' : '振り返りの案内をスキップします');
          reload();
        }} />
        <span className="grow">17時以降に振り返りを聞く</span>
      </label>

      <div className="label">ほかの端末で使う</div>
      <div className="small muted" style={{ marginBottom: 8 }}>ほかの端末の「コードでログイン」に入力</div>
      {code ? (
        <>
          <div className="code-big">{code}</div>
          <div className="small muted" style={{ textAlign: 'center', marginTop: 6 }}>あと {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</div>
        </>
      ) : <button className="btn primary block" onClick={issue}>6桁のコードを出す</button>}
      {devices.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {devices.map((d, i) => <div key={i} className="li small"><span className="grow"><Emoji char="💻" size={18} /> {d.device}</span><span className="muted">{fmtJpDate(localDateOf(d.last_used_at), false)} 最終利用</span></div>)}
        </div>
      )}

      <div className="label">この端末の通知</div>
      {!supported ? (
        <div className="small muted">{!state.pushKey ? 'プッシュ通知は準備中です' : ios && !standalone ? 'ホーム画面に追加すると通知を受け取れます' : 'このブラウザは通知に対応していません'}</div>
      ) : sub ? (
        <div className="row">
          <span className="grow small"><Emoji char="🔔" size={18} /> オン</span>
          <button className="btn small" onClick={testPush}>テスト</button>
          <button className="btn small" onClick={disablePush}>オフ</button>
        </div>
      ) : (
        <>
          <button className="btn primary block" onClick={enablePush} disabled={perm === 'denied' || pushBusy}><Emoji char="🔔" size={20} />この端末で通知を受け取る</button>
          {perm === 'denied' && <div className="small err">{ios ? 'iPhone の「設定」→「通知」→「わすれないYO」で通知を許可してください' : 'ブラウザの設定で通知がブロックされています。サイトの設定から許可してください'}</div>}
        </>
      )}
      {pushErr && <div className="small err" style={{ marginTop: 6, wordBreak: 'break-all' }}>{pushErr}</div>}

      <div className="label">キーボード操作</div>
      <div className="small muted" style={{ lineHeight: 2 }}>
        <kbd>N</kbd> メモ　<kbd>A</kbd> 予定を追加　<kbd>T</kbd> 今日　<kbd>D</kbd>/<kbd>W</kbd>/<kbd>M</kbd> 日・週・月　<kbd>←</kbd><kbd>→</kbd> 前後　<kbd>Tab</kbd> 切り替えを選ぶ → <kbd>Enter</kbd>
      </div>

      {skippedConfirms && (
        <>
          <div className="label">削除の確認</div>
          <button className="btn block" onClick={() => { resetSkippedConfirms(); setSkippedConfirms(false); notify('削除するときに確認します'); }}>削除の確認を表示する</button>
        </>
      )}

      <div className="hr" />
      <button className="btn danger block" onClick={async () => {
        if (!confirm('この端末からログアウトしますか？')) return;
        await api('auth/logout', 'POST');
        try { localStorage.removeItem('state-cache-v1'); } catch { /* なし */ }
        location.reload();
      }}>この端末からログアウト</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- お知らせ履歴

export function NoticePanel({ state, onClose, onReview, reviewSeen }: { state: State; onClose: () => void; onReview: () => void; reviewSeen: boolean }) {
  useEffect(() => { api('notifications/read', 'POST', {}).catch(() => {}); }, []);
  const evening = new Date().getHours() >= 17;
  return (
    <Sheet title="お知らせ" icon="bell" onClose={onClose}>
      {/* 17時から日付が変わるまで、いつでも今日の振り返りを開ける */}
      {evening && (
        <button className={'notice notice-review' + (reviewSeen ? '' : ' unread')} onClick={onReview}>
          <Emoji char="🎉" size={22} />
          <span className="grow"><b>今日の振り返り</b></span>
          <Icon name="right" size={18} />
        </button>
      )}
      {state.notifications.length === 0 && !evening && <div className="empty">お知らせはまだありません</div>}
      {state.notifications.map(n => (
        <div key={n.id} className={'notice' + (n.read_at ? '' : ' unread')}>
          <div><Emoji char={n.kind === 'done' ? '🎉' : n.kind === 'created' ? '✨' : '💬'} size={18} /> <EmojiText text={n.body} /></div>
          <div className="small muted">{fmtJpDate(localDateOf(n.created_at), false)} {hhmm(n.created_at)}</div>
        </div>
      ))}
    </Sheet>
  );
}
