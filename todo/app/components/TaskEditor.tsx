'use client';
import { useEffect, useState } from 'react';
import { confirmDelete } from '../confirm';
import { addDays, daysBetween, KIND_PRESETS, titleOr, REMINDER_CHOICES, REMINDER_LABELS, WEEK_LABELS, weekday, type Repeat } from '@/lib/time';
import Icon from './Icon';
import Emoji from './Emoji';
import { act, draftTask, P } from '../store';
import { api, groupColor, hhmm, localToday, memberColor, type State, type Task } from '../lib';

export type EditorInit = { task?: Task; day?: string; time?: string; groupId?: string; kind?: string; occDay?: string; title?: string; assignees?: string[]; detail?: boolean; duration?: number };

type Scope = 'one' | 'following' | 'all';
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
  // 繰り返しの予定は、開いた日の分として見せる（「すべて」で保存するときは、ずらした日数だけ全体をずらす）
  const isRepeat = !!t?.repeat && !!t.date && !isDraft;
  const openedDay = init.occDay || t?.date || localToday();
  const [date, setDate] = useState<string>(t ? (isRepeat ? openedDay : t.date || (isDraft ? localToday() : '')) : init.day || localToday());
  // 繰り返しの予定を保存・削除するとき、どこまで変えるかを聞く
  const [askScope, setAskScope] = useState<null | 'save' | 'delete'>(null);
  const [time, setTime] = useState<string>(t?.time || init.time || '');
  const [duration, setDuration] = useState(t?.duration_min || init.duration || 60);
  // 複数日の予定（出張など）の最後の日。空ならその日だけ
  const [endDate, setEndDate] = useState<string>(t?.end_date || '');
  const multi = !!date && !!endDate && endDate > date;
  // 選べる通知だけ持つ（時間ちょうどは自動。1時間前・10分前はもう選べない）
  const [reminders, setReminders] = useState<string[]>((t && !isDraft ? t.reminders : KIND_PRESETS[init.kind || 'general'].reminders).filter(r => REMINDER_CHOICES.includes(r)));
  // グループを選んだ状態で新しく入れるときは、グループ欄を出さない（別のグループに入れることはまずないため）
  const hideGroup = !t && !!init.groupId;
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
  const color = null; // 色は表示する人で決まる（lib.ts の taskColor）
  const [repeat, setRepeat] = useState<Repeat | null>(t?.repeat || null);
  // 曜日ボタンは「毎週」を選んだときだけ出す
  const [weeklyOpen, setWeeklyOpen] = useState(() => {
    const r = t?.repeat;
    if (r?.freq !== 'weekly') return false;
    const ds = r.weekdays || [];
    return !((r.interval || 1) === 1 && ds.length === 5 && [1, 2, 3, 4, 5].every(w => ds.includes(w)));
  });
  const [newItems, setNewItems] = useState<string[]>([]);
  const [itemText, setItemText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const group = state.groups.find(g => g.id === groupId);
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

  async function save(scope?: Scope) {
    setErr('');
    if (isRepeat && !scope) { setAskScope('save'); return; }
    setBusy(true);
    if (memoMode) {
      // メモのまま保存（ひとこと・詳細だけ）
      onSaved('メモを保存しました');
      act(P.updateTask(t!.id, { title, description }), () => api(`tasks/${t!.id}`, 'PATCH', { title, description }));
      return;
    }
    const body = {
      starred,
      group_id: groupId, title, description, kind, kind_id: kindId, color, date: date || null, end_date: multi ? endDate : null,
      time: date && time && !multi ? time : null,
      duration_min: duration, reminders: time && !multi ? reminders.filter(r => REMINDER_CHOICES.includes(r)) : [], remind_all: assignees === null && remindAll,
      ...(group && !group.is_personal ? { assignees: assignees === null ? 'all' : assignees } : {}),
      repeat: date && !multi ? repeat : null,
    };
    // 画面を先に書き換えて閉じる。送信は裏で
    const shared = !!group && !group.is_personal;
    const fields = {
      group_id: groupId, title, description, kind: kindId ? 'general' : kind, kind_id: kindId, color,
      date: body.date, end_date: body.end_date, time: body.time, duration_min: duration, reminders: body.reminders, remind_all: body.remind_all,
      repeat: body.repeat, starred, assignees: shared ? assignees : null,
    };
    onSaved(isDraft ? 'メモを予定にしました' : t ? '保存しました' : '追加しました');
    if (t && isRepeat && scope && scope !== 'all') {
      // この日だけ／この日以降すべて
      act(P.splitTask(t.id, openedDay, scope, fields), () => api(`tasks/${t.id}/split`, 'POST', { ...body, day: openedDay, scope }));
    } else if (t && isRepeat) {
      // すべて：開いた日からずらした日数だけ、繰り返し全体をずらす。外した日はそのまま
      const start = repeat && date ? addDays(t.date!, daysBetween(openedDay, date)) : date || null;
      const rep = repeat ? { ...repeat, except: t.repeat!.except || [] } : null;
      const all = { ...body, date: start, repeat: rep };
      act(P.updateTask(t.id, { ...fields, date: start, repeat: rep }), () => api(`tasks/${t.id}`, 'PATCH', all));
    } else if (t) {
      act(P.updateTask(t.id, { ...fields, ...(isDraft ? { status: 'ready' as const } : {}) }), () => api(`tasks/${t.id}`, 'PATCH', { ...body, ...(isDraft ? { status: 'ready' } : {}) }));
    } else {
      act(P.addTask(draftTask(state, fields), kind === 'shopping' ? newItems : []), () => api('tasks', 'POST', { ...body, items: newItems }));
    }
  }

  // メモの「完了」：書いた内容を保存して、完了にする（メモの一覧から消える）
  function doneMemo() {
    if (!t) return;
    onSaved('完了！おつかれさまです 🎉');
    act(P.doneMemo(t.id, { title, description }, meId), async () => {
      await api(`tasks/${t.id}`, 'PATCH', { title, description });
      return api(`tasks/${t.id}/done`, 'POST', { done: true });
    });
  }

  async function remove(scope?: Scope) {
    if (!t) return;
    if (isRepeat && !scope) { setAskScope('delete'); return; }
    if (!isRepeat && !(await confirmDelete(isDraft ? 'このメモを削除しますか？' : `「${titleOr(t)}」を削除しますか？`, 'task'))) return;
    onSaved('削除しました');
    if (isRepeat && scope && scope !== 'all') act(P.splitTask(t.id, openedDay, scope, null), () => api(`tasks/${t.id}/split`, 'POST', { day: openedDay, scope, delete: true }));
    else act(P.removeTask(t.id), () => api(`tasks/${t.id}`, 'DELETE'));
  }


  // キーボード：Esc で閉じる、Enter で保存（詳細の欄の中では改行。日本語の変換中は何もしない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (askScope) { if (e.key === 'Escape') { e.preventDefault(); setAskScope(null); } return; }
      const el = e.target as HTMLElement;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.shiftKey || e.defaultPrevented) return;
      if (['TEXTAREA', 'BUTTON', 'SELECT', 'A'].includes(el.tagName)) return;
      if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'checkbox') return;
      e.preventDefault();
      save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
      <div className={'sheet' + (showSettings && !memoMode ? ' sheet-wide' : '')} onClick={e => e.stopPropagation()}>
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
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} autoFocus={!t} maxLength={120} aria-label="タイトル" />

          {!showSettings && (
            <>
              <div className="label">詳細</div>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} />
              <button className="settings-toggle" onClick={() => setShowSettings(true)} aria-expanded={false}>
                <span className="settings-summary">
                  {[date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}${multi ? `〜${Number(endDate.slice(5, 7))}/${Number(endDate.slice(8))}` : ''}` : '日付なし', multi ? '' : time || (date ? '終日' : ''), group?.is_personal ? '' : group?.name,
                    kindId ? (state.kinds || []).find(k => k.id === kindId)?.name : KIND_PRESETS[kind]?.label, repeat ? '繰り返し' : ''].filter(Boolean).join('・')}
                </span>
                <span className="settings-open">設定 ▼</span>
              </button>
            </>
          )}
          {showSettings && (<>
          {t && !isDraft && <button className="settings-toggle close" onClick={() => setShowSettings(false)} aria-expanded>設定 ▲</button>}
          <div className="editor-grid">
          <div className="editor-col">
          <div className="label">日時</div>
          <div className="row">
            <input type="date" value={date} onChange={e => { setDate(e.target.value); if (endDate && e.target.value && endDate <= e.target.value) setEndDate(''); }} style={{ flex: 1.3 }} aria-label="日付" />
            {multi ? (
              <>
                <span className="muted">〜</span>
                <input type="date" value={endDate} min={date ? addDays(date, 1) : undefined} onChange={e => setEndDate(e.target.value)} style={{ flex: 1.3 }} aria-label="最後の日" />
              </>
            ) : (
              <input type="time" value={time} onChange={e => setTime(e.target.value)} disabled={!date} style={{ flex: 1 }} aria-label="時刻" />
            )}
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            {date && <button className="chip" onClick={() => { setDate(''); setTime(''); setEndDate(''); setRepeat(null); }}>日付なし</button>}
            {date && !multi && !repeat && <button className="chip" onClick={() => { setEndDate(addDays(date, 1)); setTime(''); }}>複数日</button>}
            {multi && <button className="chip" onClick={() => setEndDate('')}>1日だけ</button>}
            {time && !multi && <button className="chip" onClick={() => setTime('')}>終日</button>}
            {time && !multi && (
              <select value={duration} onChange={e => setDuration(Number(e.target.value))} style={{ width: 'auto', padding: '6px 10px' }} aria-label="長さ">
                {[...new Set([15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, duration])].sort((a, b) => a - b).map(m => (
                  <option key={m} value={m}>{m < 60 ? `${m}分` : m % 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m / 60}時間`}</option>
                ))}
              </select>
            )}
          </div>

          {time && !multi && (
            <>
              <div className="label">通知</div>
              <div className="row wrap">
                {REMINDER_CHOICES.map(r => (
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

          {date && !multi && (
            <>
              <div className="label">繰り返し</div>
              <div className="row wrap">
                <button className={'chip' + (!repeat ? ' on' : '')} onClick={() => { setRepeat(null); setWeeklyOpen(false); }}>なし</button>
                <button className={'chip' + (repeat?.freq === 'daily' ? ' on' : '')} onClick={() => { setWeeklyOpen(false); setRepeat({ freq: 'daily', interval: 1, weekdays: [], monthMode: 'day', until: repeat?.until || null }); }}>毎日</button>
                <button className={'chip' + (isWeekdays && !weeklyOpen ? ' on' : '')} onClick={() => { setWeeklyOpen(false); setWeekly(WEEKDAYS); }}>平日</button>
                <button className={'chip' + (repeat?.freq === 'weekly' && (weeklyOpen || !isWeekdays) ? ' on' : '')} onClick={() => { setWeeklyOpen(true); if (repeat?.freq !== 'weekly' || isWeekdays) setWeekly([baseWeekday]); }}>毎週</button>
                <button className={'chip' + (repeat?.freq === 'monthly' ? ' on' : '')} onClick={() => { setWeeklyOpen(false); setRepeat({ freq: 'monthly', interval: 1, weekdays: [], monthMode: 'day', until: repeat?.until || null }); }}>毎月</button>
              </div>
              {/* 曜日ボタン：「毎週」のときだけ。押した曜日に毎週くり返す */}
              {weeklyOpen && repeat?.freq === 'weekly' && (
                <div className="weekday-row">
                  {[0, 1, 2, 3, 4, 5, 6].map(w => (
                    <button key={w} className={'chip' + (weeklyDays.includes(w) ? ' on' : '') + (w === 0 ? ' sun' : w === 6 ? ' sat' : '')}
                      onClick={() => toggleWeekday(w)} aria-pressed={weeklyDays.includes(w)}>
                      {WEEK_LABELS[w]}
                    </button>
                  ))}
                </div>
              )}
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
                  <select value={repeat.interval || 1} onChange={e => setRepeat({ ...repeat, interval: Number(e.target.value) })} style={{ width: 'auto' }} aria-label="間隔">
                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 1 ? '毎回' : `${n}${repeat.freq === 'daily' ? '日' : repeat.freq === 'weekly' ? '週間' : 'か月'}に1回`}</option>)}
                  </select>
                  <span className="small muted">終了日</span>
                  <input type="date" value={repeat.until || ''} onChange={e => setRepeat({ ...repeat, until: e.target.value || null })} style={{ flex: 1 }} aria-label="終了日" />
                </div>
              )}
            </>
          )}
          </div>
          <div className="editor-col">
          {!hideGroup && (
            <>
              <div className="label">グループ</div>
              <div className="row wrap">
                {state.groups.map(g => (
                  <button key={g.id} className={'chip' + (g.id === groupId ? ' on' : '')} onClick={() => pickGroup(g.id)}>
                    <span className="dot" style={{ background: groupColor(g), marginRight: 6 }} />{g.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {group && !group.is_personal && (
            <>
              <div className="label">表示する人</div>
              <div className="row wrap">
                <button className={'chip' + (assignees === null ? ' on' : '')} onClick={() => setAssignees(null)}><span className="dot" style={{ background: groupColor(group), marginRight: 6 }} />共通</button>
                {[...group.members].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0)).map(m => {
                  const on = !!assignees?.includes(m.id);
                  return (
                    <button key={m.id} className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => {
                      if (assignees === null) { setAssignees([m.id]); return; }
                      if (on && assignees.length === 1) return; // 誰もいなくはできない
                      setAssignees(on ? assignees.filter(x => x !== m.id) : [...assignees, m.id]);
                    }}><span className="dot" style={{ background: memberColor(group, m.id), marginRight: 6 }} />{m.id === meId ? '自分' : m.name}</button>
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
                  <input type="text" value={itemText} onChange={e => setItemText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addItem(); } }} />
                  <button className="btn small" onClick={addItem}>追加</button>
                </div>
              </div>
            </>
          )}

          <div className="label">詳細</div>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />

          </div>

          </div>

          </>)}
          </>)}

          {err && <div className="err">{err}</div>}
        </div>
        <div className="sheet-foot">
          {t && <button className="btn danger" onClick={() => remove()}>削除</button>}
          <div className="grow" />
          {memoMode && <button className="btn memo-done" onClick={doneMemo}><Icon name="check" size={16} stroke={2.6} />完了</button>}
          <button className="btn" onClick={onClose}>キャンセル</button>
          <button className="btn primary" onClick={() => save()} disabled={busy}>保存</button>
        </div>
      </div>
      {askScope && (
        <div className="banner" onClick={e => { e.stopPropagation(); setAskScope(null); }}>
          <div className="banner-card scope-card" role="dialog" aria-label={askScope === 'save' ? '繰り返しの予定を変更' : '繰り返しの予定を削除'} onClick={e => e.stopPropagation()}>
            <h2>{askScope === 'save' ? '繰り返しの予定を変更' : '繰り返しの予定を削除'}</h2>
            <div className="muted">{Number(openedDay.slice(5, 7))}月{Number(openedDay.slice(8))}日（{WEEK_LABELS[weekday(openedDay)]}）の分</div>
            <div className="confirm-actions">
              {([['one', 'この日だけ'], ['following', 'この日以降すべて'], ['all', 'すべて']] as [Scope, string][]).map(([s, label]) => (
                <button key={s} className={'btn big' + (askScope === 'delete' ? ' danger' : '')} onClick={() => { setAskScope(null); if (askScope === 'save') save(s); else remove(s); }}>{label}</button>
              ))}
              <button className="btn" onClick={() => setAskScope(null)}>キャンセル</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
