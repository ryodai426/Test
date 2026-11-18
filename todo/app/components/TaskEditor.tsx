'use client';
import { useState } from 'react';
import { KIND_PRESETS, REMINDER_LABELS, WEEK_LABELS, weekday, type Repeat } from '@/lib/time';
import Icon from './Icon';
import Emoji from './Emoji';
import { act, draftTask, P } from '../store';
import { api, hhmm, localToday, PALETTE, type State, type Task } from '../lib';

export type EditorInit = { task?: Task; day?: string; time?: string; groupId?: string; kind?: string; occDay?: string; title?: string; assignees?: string[]; detail?: boolean; duration?: number };

const REMINDER_ORDER = ['eve', '60', '30', '10', '5', '0'];
const WEEKDAYS = [1, 2, 3, 4, 5];

export default function TaskEditor({ state, init, onClose, onSaved, onRefresh }: {
  state: State; init: EditorInit; onClose: () => void; onSaved: (msg?: string) => void; onRefresh: () => Promise<void>;
}) {
  const t = init.task;
  const isDraft = t?.status === 'draft';
  const personal = state.groups.find(g => g.is_personal)!;
  const [groupId, setGroupId] = useState(t?.group_id || init.groupId || personal.id);
  const [title, setTitle] = useState(t?.title || init.title || '');
  const [description, setDescription] = useState(t?.description || '');
  const [kind, setKind] = useState(t?.kind || init.kind || 'general');
  const [kindId, setKindId] = useState<string | null>(t?.kind_id || null);
  const [addingKind, setAddingKind] = useState(false);
  const [kindName, setKindName] = useState('');
  const [date, setDate] = useState<string>(t ? t.date || (isDraft ? localToday() : '') : init.day || localToday());
  const [time, setTime] = useState<string>(t?.time || init.time || '');
  const [duration, setDuration] = useState(t?.duration_min || init.duration || 60);
  const [reminders, setReminders] = useState<string[]>(t && !isDraft ? t.reminders : KIND_PRESETS[init.kind || 'general'].reminders);
  const [remindAll, setRemindAll] = useState(t?.remind_all || false);
  const [starred, setStarred] = useState(!!t?.starred);
  // メモは「ひとこと」と「詳細」だけ。「詳細に記録する」にチェックしたときだけ、ふつうの入力欄を出す
  const [detailMode, setDetailMode] = useState(!!init.detail);
  const memoMode = isDraft && !detailMode;
  // 一度入れた予定を開いたときは、タイトルと詳細だけ。ほかの設定は「設定」で開く
  const [showSettings, setShowSettings] = useState(!t || isDraft);
  const meId = state.me!.id;
  // 表示する人：null ＝ 共通（全員）。新しく入れる予定は「自分だけ」から
  const [assignees, setAssignees] = useState<string[] | null>(t ? (t.assignees ?? null) : (init.assignees ?? [meId]));
  const [color, setColor] = useState<string | null>(t?.color || null);
  const [repeat, setRepeat] = useState<Repeat | null>(t?.repeat || null);
  const [newItems, setNewItems] = useState<string[]>([]);
  const [itemText, setItemText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const group = state.groups.find(g => g.id === groupId);
  const groupColor = group?.color || '#6B7280';
  const items = t ? state.items.filter(i => i.task_id === t.id) : [];
  const occDay = init.occDay || t?.date || localToday();

  const groupKinds = (state.kinds || []).filter(k => k.group_id === groupId);

  function pickGroup(id: string) {
    setGroupId(id);
    // 別のグループに移したら、そのグループにいない人は外す（誰もいなくなれば自分だけ）
    const g = state.groups.find(x => x.id === id);
    if (g && assignees) {
      const keep = assignees.filter(a => g.members.some(m => m.id === a));
      setAssignees(keep.length ? keep : [meId]);
    }
    // 自分たちで足した種類はグループごとなので、別のグループに移したら外す
    if (kindId && !(state.kinds || []).some(k => k.id === kindId && k.group_id === id)) { setKindId(null); setKind('general'); }
  }

  function pickCustomKind(id: string) {
    setKindId(id);
    setKind('general');
    setReminders(KIND_PRESETS.general.reminders);
  }

  async function addKind() {
    const name = kindName.trim();
    if (!name) return;
    try {
      const r = await api<{ id: string }>(`groups/${groupId}/kinds`, 'POST', { name });
      setKindName('');
      setAddingKind(false);
      await onRefresh();
      pickCustomKind(r.id);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  function pickKind(k: string) {
    setKindId(null);
    setKind(k);
    setReminders(KIND_PRESETS[k].reminders); // 種類を選ぶと通知も自動で決まる
    if (k === 'shopping') { setTime(''); }
  }

  function toggleReminder(r: string) {
    setReminders(rs => (rs.includes(r) ? rs.filter(x => x !== r) : [...rs, r]));
  }

  async function save() {
    setErr('');
    if (!memoMode && !title.trim()) { setErr('タイトルを入力してください'); return; }
    setBusy(true);
    if (memoMode) {
      // メモのまま保存（ひとこと・詳細だけ）
      onSaved('メモを保存しました');
      act(P.updateTask(t!.id, { title, description }), () => api(`tasks/${t!.id}`, 'PATCH', { title, description }));
      return;
    }
    const body = {
      starred,
      group_id: groupId, title, description, kind, kind_id: kindId, color, date: date || null, time: date && time ? time : null,
      duration_min: duration, reminders: time ? reminders : [], remind_all: assignees === null && remindAll,
      ...(group && !group.is_personal ? { assignees: assignees === null ? 'all' : assignees } : {}),
      repeat: date ? repeat : null,
    };
    // 画面を先に書き換えて閉じる。送信は裏で
    const shared = !!group && !group.is_personal;
    const fields = {
      group_id: groupId, title, description, kind: kindId ? 'general' : kind, kind_id: kindId, color,
      date: body.date, time: body.time, duration_min: duration, reminders: body.reminders, remind_all: body.remind_all,
      repeat: body.repeat, starred, assignees: shared ? assignees : null,
    };
    onSaved(isDraft ? 'メモを予定にしました' : t ? '保存しました' : '追加しました');
    if (t) {
      act(P.updateTask(t.id, { ...fields, ...(isDraft ? { status: 'ready' as const } : {}) }), () => api(`tasks/${t.id}`, 'PATCH', { ...body, ...(isDraft ? { status: 'ready' } : {}) }));
    } else {
      act(P.addTask(draftTask(state, fields), kind === 'shopping' ? newItems : []), () => api('tasks', 'POST', { ...body, items: newItems }));
    }
  }

  async function remove() {
    if (!t || !confirm(isDraft ? 'このメモを削除しますか？' : `「${t.title || 'タスク'}」を削除しますか？${t.repeat ? '\n繰り返しの予定はすべて消えます' : ''}`)) return;
    onSaved('削除しました');
    act(P.removeTask(t.id), () => api(`tasks/${t.id}`, 'DELETE'));
  }


  async function addItem() {
    const labels = itemText.split(/[、,\n]/).map(s => s.trim()).filter(Boolean);
    if (!labels.length) return;
    setItemText('');
    if (t) act(P.addItems(t.id, labels), () => api(`tasks/${t.id}/items`, 'POST', { labels }));
    else setNewItems(xs => [...xs, ...labels]);
  }

  const baseWeekday = date ? weekday(date) : 1;
  const weeklyDays = repeat?.freq === 'weekly' ? (repeat.weekdays?.length ? repeat.weekdays : [baseWeekday]) : [];
  const isWeekdays = repeat?.freq === 'weekly' && (repeat.interval || 1) === 1
    && weeklyDays.length === 5 && WEEKDAYS.every(w => weeklyDays.includes(w));

  function setWeekly(days: number[]) {
    if (!days.length) { setRepeat(null); return; }
    setRepeat({
      freq: 'weekly', interval: repeat?.freq === 'weekly' ? repeat.interval || 1 : 1,
      weekdays: [...days].sort((a, b) => a - b), monthMode: 'day', until: repeat?.until || null,
    });
  }

  function toggleWeekday(w: number) {
    setWeekly(weeklyDays.includes(w) ? weeklyDays.filter(x => x !== w) : [...weeklyDays, w]);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{memoMode ? 'メモ' : isDraft ? 'メモを予定にする' : t ? '予定・タスク' : '新しい予定・タスク'}</h3>
          {!memoMode && (
            <button className={'star-btn' + (starred ? ' on' : '')} onClick={() => setStarred(v => !v)} aria-pressed={starred}
              aria-label={starred ? '星を外す' : '星を付ける'} title={starred ? '星を外す' : '星を付ける'}>
              {starred ? '★' : '☆'}
            </button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="閉じる"><Icon name="close" size={20} /></button>
        </div>
        <div className="sheet-body">
          {isDraft && <div className="small muted" style={{ marginTop: 2 }}>{hhmm(t!.captured_at)} にメモしました</div>}

          {memoMode ? (
            <>
              <div className="label">ひとこと</div>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="例：田中さんに電話" maxLength={120} />
              <div className="label">詳細</div>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="思い出せるように、少しだけ書いておく" rows={4} />
              <label className="detail-toggle">
                <input type="checkbox" checked={detailMode} onChange={e => setDetailMode(e.target.checked)} />
                <span>詳細に記録する</span>
              </label>
            </>
          ) : (<>
          {isDraft && (
            <label className="detail-toggle">
              <input type="checkbox" checked={detailMode} onChange={e => setDetailMode(e.target.checked)} />
              <span>詳細に記録する</span>
            </label>
          )}

          <div className="label">タイトル</div>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="例：会議、小麦粉を買う" autoFocus={!t} maxLength={120} />

          {!showSettings && (
            <>
              <div className="label">詳細</div>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} />
              <button className="settings-toggle" onClick={() => setShowSettings(true)} aria-expanded={false}>
                <span className="settings-summary">
                  {[date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}` : '日付なし', time || (date ? '終日' : ''), group?.is_personal ? '' : group?.name,
                    kindId ? (state.kinds || []).find(k => k.id === kindId)?.name : KIND_PRESETS[kind]?.label, repeat ? '繰り返し' : ''].filter(Boolean).join('・')}
                </span>
                <span className="settings-open">設定 ▼</span>
              </button>
            </>
          )}
          {showSettings && (<>
          {t && !isDraft && <button className="settings-toggle close" onClick={() => setShowSettings(false)} aria-expanded>設定 ▲</button>}
          <div className="label">グループ</div>
          <div className="row wrap">
            {state.groups.map(g => (
              <button key={g.id} className={'chip' + (g.id === groupId ? ' on' : '')} onClick={() => pickGroup(g.id)}>
                <span className="dot" style={{ background: g.color, marginRight: 6 }} />{g.name}
              </button>
            ))}
          </div>
          {group && !group.is_personal && (
            <>
              <div className="label">表示する人</div>
              <div className="row wrap">
                <button className={'chip' + (assignees === null ? ' on' : '')} onClick={() => setAssignees(null)}>共通</button>
                {[...group.members].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0)).map(m => {
                  const on = !!assignees?.includes(m.id);
                  return (
                    <button key={m.id} className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => {
                      if (assignees === null) { setAssignees([m.id]); return; }
                      if (on && assignees.length === 1) return; // 誰もいなくはできない
                      setAssignees(on ? assignees.filter(x => x !== m.id) : [...assignees, m.id]);
                    }}>{m.id === meId ? '自分' : m.name}</button>
                  );
                })}
              </div>
            </>
          )}

          <div className="label">種類</div>
          <div className="row wrap">
            {/* 買い物は「リスト」にまとめたので選べない（前に作った買い物の予定だけ表示） */}
            {Object.entries(KIND_PRESETS).filter(([k]) => k !== 'shopping' || t?.kind === 'shopping').map(([k, v]) => (
              <button key={k} className={'chip' + (!kindId && k === kind ? ' on' : '')} onClick={() => pickKind(k)}><Emoji char={v.icon} size={18} />&nbsp;{v.label}</button>
            ))}
            {groupKinds.map(k => (
              <button key={k.id} className={'chip' + (kindId === k.id ? ' on' : '')} onClick={() => pickCustomKind(k.id)}>{k.name}</button>
            ))}
            {!addingKind && <button className="chip dashed" onClick={() => setAddingKind(true)}>＋ 種類を追加</button>}
          </div>
          {addingKind && (
            <div className="row" style={{ marginTop: 8 }}>
              <input type="text" value={kindName} onChange={e => setKindName(e.target.value)} maxLength={20} autoFocus
                placeholder={group && !group.is_personal ? `「${group.name}」のみんなで使う種類` : '例：通院、勉強'}
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addKind(); } }} />
              <button className="btn small primary" onClick={addKind} disabled={!kindName.trim()}>追加</button>
              <button className="btn small" onClick={() => { setAddingKind(false); setKindName(''); }}>やめる</button>
            </div>
          )}

          {kind === 'shopping' && (
            <>
              <div className="label">買うもの</div>
              <div className="card" style={{ marginTop: 0 }}>
                {(t ? items : newItems.map((label, i) => ({ id: String(i), label, checked: false }))).map((it, i) => (
                  <div key={it.id} className={'li' + (it.checked ? ' on' : '')}>
                    <span className="grow">{it.label}</span>
                    <button className="del" onClick={async () => {
                      if (t) act(P.removeItem(it.id), () => api(`items/${it.id}`, 'DELETE')); else setNewItems(xs => xs.filter((_, j) => j !== i));
                    }} aria-label="削除">×</button>
                  </div>
                ))}
                <div className="row" style={{ marginTop: 6 }}>
                  <input type="text" value={itemText} onChange={e => setItemText(e.target.value)} placeholder="小麦粉、卵、牛乳"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addItem(); } }} />
                  <button className="btn small" onClick={addItem}>追加</button>
                </div>
              </div>
            </>
          )}

          <div className="label">日時</div>
          <div className="row">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ flex: 1.3 }} />
            <input type="time" value={time} onChange={e => setTime(e.target.value)} disabled={!date} style={{ flex: 1 }} />
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            {date && <button className="chip" onClick={() => { setDate(''); setTime(''); setRepeat(null); }}>日付なし</button>}
            {time && <button className="chip" onClick={() => setTime('')}>終日</button>}
            {time && (
              <select value={duration} onChange={e => setDuration(Number(e.target.value))} style={{ width: 'auto', padding: '6px 10px' }}>
                {[...new Set([15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, duration])].sort((a, b) => a - b).map(m => (
                  <option key={m} value={m}>{m < 60 ? `${m}分` : m % 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m / 60}時間`}</option>
                ))}
              </select>
            )}
          </div>

          {time && (
            <>
              <div className="label">通知</div>
              <div className="row wrap">
                {REMINDER_ORDER.map(r => (
                  <button key={r} className={'chip' + (reminders.includes(r) ? ' on' : '')} onClick={() => toggleReminder(r)}>{REMINDER_LABELS[r]}</button>
                ))}
              </div>
              {group && !group.is_personal && assignees === null && (
                <label className="row small" style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={remindAll} onChange={e => setRemindAll(e.target.checked)} />
                  グループのメンバー全員にも通知する
                </label>
              )}
            </>
          )}

          {date && (
            <>
              <div className="label">繰り返し</div>
              <div className="row wrap">
                <button className={'chip' + (!repeat ? ' on' : '')} onClick={() => setRepeat(null)}>なし</button>
                <button className={'chip' + (repeat?.freq === 'daily' ? ' on' : '')} onClick={() => setRepeat({ freq: 'daily', interval: 1, weekdays: [], monthMode: 'day', until: repeat?.until || null })}>毎日</button>
                <button className={'chip' + (isWeekdays ? ' on' : '')} onClick={() => setWeekly(WEEKDAYS)}>平日</button>
                <button className={'chip' + (repeat?.freq === 'weekly' && !isWeekdays ? ' on' : '')} onClick={() => setWeekly([baseWeekday])}>毎週</button>
                <button className={'chip' + (repeat?.freq === 'monthly' ? ' on' : '')} onClick={() => setRepeat({ freq: 'monthly', interval: 1, weekdays: [], monthMode: 'day', until: repeat?.until || null })}>毎月</button>
              </div>
              {/* 曜日ボタン：押した曜日に毎週くり返す（月〜金を押せば平日の予定になる） */}
              <div className="weekday-row">
                {[0, 1, 2, 3, 4, 5, 6].map(w => (
                  <button key={w} className={'chip' + (weeklyDays.includes(w) ? ' on' : '') + (w === 0 ? ' sun' : w === 6 ? ' sat' : '')}
                    onClick={() => toggleWeekday(w)} aria-pressed={weeklyDays.includes(w)}>
                    {WEEK_LABELS[w]}
                  </button>
                ))}
              </div>
              {repeat?.freq === 'monthly' && date && (
                <div className="row wrap" style={{ marginTop: 8 }}>
                  <button className={'chip' + (repeat.monthMode !== 'nth' ? ' on' : '')} onClick={() => setRepeat({ ...repeat, monthMode: 'day' })}>毎月{Number(date.slice(8))}日</button>
                  <button className={'chip' + (repeat.monthMode === 'nth' ? ' on' : '')} onClick={() => setRepeat({ ...repeat, monthMode: 'nth' })}>
                    毎月第{Math.ceil(Number(date.slice(8)) / 7)}{WEEK_LABELS[weekday(date)]}曜日
                  </button>
                </div>
              )}
              {repeat && (
                <div className="row" style={{ marginTop: 8 }}>
                  <select value={repeat.interval || 1} onChange={e => setRepeat({ ...repeat, interval: Number(e.target.value) })} style={{ width: 'auto' }}>
                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 1 ? '毎回' : `${n}${repeat.freq === 'daily' ? '日' : repeat.freq === 'weekly' ? '週間' : 'か月'}に1回`}</option>)}
                  </select>
                  <span className="small muted">終了日</span>
                  <input type="date" value={repeat.until || ''} onChange={e => setRepeat({ ...repeat, until: e.target.value || null })} style={{ flex: 1 }} />
                </div>
              )}
            </>
          )}

          <div className="label">詳細</div>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="例：営業部との定例会議" />

          <div className="label">色</div>
          <div className="row wrap" style={{ gap: 10 }}>
            <button className={'swatch' + (!color ? ' on' : '')} style={{ background: groupColor }} title="グループの色" onClick={() => setColor(null)} />
            {PALETTE.filter(c => c !== groupColor).slice(0, 6).map(c => (
              <button key={c} className={'swatch' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
            <label className="small muted row" style={{ gap: 4 }}>
              カスタム <input type="color" value={color || groupColor} onChange={e => setColor(e.target.value)} style={{ width: 34, height: 30, border: 0, background: 'none' }} />
            </label>
          </div>

          </>)}
          </>)}

          {err && <div className="err">{err}</div>}
        </div>
        <div className="sheet-foot">
          {t && <button className="btn danger" onClick={remove}>削除</button>}
          <div className="grow" />
          <button className="btn" onClick={onClose}>キャンセル</button>
          <button className="btn primary" onClick={save} disabled={busy}>保存</button>
        </div>
      </div>
    </div>
  );
}
