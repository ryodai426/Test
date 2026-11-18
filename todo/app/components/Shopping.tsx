'use client';
import { useState } from 'react';
import { api, fmtJpDate, isFor, type Item, type State, type Task } from '../lib';
import Icon from './Icon';

// ---------------------------------------------------------------- 売り場（スーパーを回る順）

const AISLES: { name: string; words: string[] }[] = [
  { name: '野菜・果物', words: ['玉ねぎ', 'たまねぎ', 'にんじん', '人参', 'じゃがいも', 'キャベツ', 'レタス', 'トマト', 'きゅうり', 'ねぎ', 'ネギ', 'ほうれん草', 'もやし', '大根', 'なす', 'ピーマン', 'ブロッコリー', 'きのこ', 'しめじ', 'えのき', 'しいたけ', 'まいたけ', 'りんご', 'バナナ', 'みかん', 'いちご', 'レモン', '野菜', '果物', '生姜', 'しょうが', 'にんにく', '白菜', 'ごぼう', 'かぼちゃ', 'アボカド', '小松菜', 'ぶどう', 'キウイ', 'さつまいも', '水菜', 'セロリ', 'オクラ', 'パプリカ', 'ズッキーニ'] },
  { name: '肉・魚', words: ['肉', '豚', '牛', '鶏', 'ひき肉', 'ミンチ', 'ベーコン', 'ハム', 'ソーセージ', 'ウインナー', '魚', '鮭', 'さけ', 'さば', '鯖', 'まぐろ', '刺身', 'えび', 'エビ', 'いか', 'たこ', 'ツナ', 'しらす', 'あじ', 'ぶり', 'たら'] },
  { name: '卵・乳製品', words: ['卵', 'たまご', 'タマゴ', '牛乳', 'ミルク', 'ヨーグルト', 'チーズ', 'バター', '生クリーム', '豆乳', 'マーガリン'] },
  { name: '豆腐・練り物', words: ['豆腐', '納豆', '油揚げ', '厚揚げ', 'こんにゃく', 'ちくわ', 'かまぼこ', 'はんぺん', 'キムチ'] },
  { name: 'パン・米・麺', words: ['パン', '食パン', '米', 'ごはん', 'うどん', 'そば', 'パスタ', 'スパゲッティ', 'ラーメン', '麺', '小麦粉', '片栗粉', 'もち', 'シリアル', 'ホットケーキ'] },
  { name: '調味料', words: ['醤油', 'しょうゆ', '味噌', 'みそ', '塩', '砂糖', '酢', 'みりん', '料理酒', '油', 'オイル', 'マヨネーズ', 'ケチャップ', 'ソース', 'だし', 'コンソメ', 'カレー', 'ドレッシング', 'こしょう', 'ポン酢', 'めんつゆ', 'はちみつ', 'ジャム'] },
  { name: '冷凍食品', words: ['冷凍', '氷', 'アイス'] },
  { name: '飲み物・お菓子', words: ['水', 'お茶', 'ジュース', 'コーヒー', '紅茶', 'ビール', '酒', 'お菓子', 'チョコ', 'ポテチ', '炭酸', 'マシュマロ', 'クッキー', 'ガム', 'ワイン'] },
  { name: '日用品', words: ['トイレットペーパー', 'ティッシュ', '洗剤', 'シャンプー', 'リンス', 'コンディショナー', '石鹸', 'せっけん', 'ボディソープ', '歯ブラシ', '歯磨き', 'ゴミ袋', 'ラップ', 'アルミホイル', '電池', 'スポンジ', 'マスク', '柔軟剤', 'キッチンペーパー', '綿棒', '絆創膏', '薬'] },
  { name: 'アウトドア', words: ['炭', '着火剤', 'ガス缶', 'ペグ', 'ランタン', '虫よけ'] },
];
const OTHER = 'そのほか';

/** 「卵 2」「牛乳×2」「トマト 3個」→ 名前と数量に分ける */
export function parseItem(label: string): { name: string; qty: string } {
  const m = label.match(/^(.*?)[\s　×xX＊*]+(\d+\s*(?:個|本|パック|袋|枚|缶|箱|玉|束|kg|g|L|ml|リットル)?)$/);
  return m && m[1].trim() ? { name: m[1].trim(), qty: m[2].replace(/\s/g, '') } : { name: label, qty: '' };
}

export function aisleOf(label: string): string {
  const { name } = parseItem(label);
  // いちばん長く一致した言葉の売り場にする（「牛乳」は「牛」ではなく「牛乳」で乳製品に）
  let best = OTHER, len = 0;
  for (const a of AISLES) for (const w of a.words) if (w.length > len && name.includes(w)) { best = a.name; len = w.length; }
  return best;
}

const AISLE_ORDER = [...AISLES.map(a => a.name), OTHER];

/** 品目を売り場ごとにまとめる（スーパーを回る順） */
function byAisle(items: Item[]) {
  const map = new Map<string, Item[]>();
  for (const it of items) {
    const a = aisleOf(it.label);
    if (!map.has(a)) map.set(a, []);
    map.get(a)!.push(it);
  }
  return AISLE_ORDER.filter(a => map.has(a)).map(a => ({ aisle: a, items: map.get(a)!.sort((x, y) => x.position - y.position) }));
}

/** よく買うもの：これまでのリストに2回以上出てきた品目（今のリストにないもの） */
function frequentItems(state: State, current: Item[]) {
  const now = new Set(current.map(i => parseItem(i.label).name));
  const count = new Map<string, number>();
  for (const it of state.items) {
    const n = parseItem(it.label).name;
    if (!n || now.has(n)) continue;
    count.set(n, (count.get(n) || 0) + 1);
  }
  // 2回以上買ったものだけ（1回きりの物は出さない）
  return [...count.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
}

function memberName(state: State, id: string | null | undefined) {
  if (!id) return '';
  if (id === state.me?.id) return '自分';
  return state.groups.flatMap(g => g.members).find(m => m.id === id)?.name || '';
}

function splitLabels(text: string) {
  return text.split(/[、,，\n]/).map(s => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- 品目の1行

function ItemRow({ state, it, shared, onToggle, onDelete, big = false }: {
  state: State; it: Item; shared: boolean; onToggle: (it: Item) => void; onDelete?: (it: Item) => void; big?: boolean;
}) {
  const { name, qty } = parseItem(it.label);
  const by = shared && it.checked ? memberName(state, it.checked_by) : '';
  return (
    <div className={(big ? 'shop-big' : 'li') + (it.checked ? ' on' : '')} onClick={() => onToggle(it)} role="checkbox" aria-checked={it.checked} tabIndex={0}
      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(it); } }}>
      <span className={'box' + (it.checked ? ' on' : '')}>{it.checked && <Icon name="check" size={big ? 18 : 15} stroke={2.6} />}</span>
      <span className="grow">{name}{qty && <span className="qty">{qty}</span>}{by && <span className="checked-by">{by}がチェック</span>}</span>
      {onDelete && <button className="del" onClick={e => { e.stopPropagation(); onDelete(it); }} aria-label={`${it.label}を消す`}>×</button>}
    </div>
  );
}

// ---------------------------------------------------------------- 買い物モード（お店で使う全画面）

export function ShoppingMode({ state, task, onClose, onToggle, onAdd }: {
  state: State; task: Task; onClose: () => void; onToggle: (it: Item) => void; onAdd: (labels: string[]) => void;
}) {
  const items = state.items.filter(i => i.task_id === task.id);
  const left = items.filter(i => !i.checked).length;
  const g = state.groups.find(x => x.id === task.group_id);
  const shared = !!g && !g.is_personal;
  const [text, setText] = useState('');
  const groups = byAisle(items);
  return (
    <div className="fullcheck shop-mode">
      <div className="row">
        <div className="grow eyebrow">買い物モード{shared ? `・${g!.name}と共有中` : ''}</div>
        <button className="icon-btn" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button>
      </div>
      <h2>{task.title}</h2>
      <div className="progress"><span>{left === 0 && items.length ? 'ぜんぶそろった！' : `残り ${left} / ${items.length}`}</span></div>
      <div className="items">
        {groups.map(({ aisle, items: its }) => (
          <div key={aisle} className="shop-aisle">
            <div className="shop-aisle-name">{aisle}</div>
            {its.sort((a, b) => Number(a.checked) - Number(b.checked)).map(it => (
              <ItemRow key={it.id} state={state} it={it} shared={shared} onToggle={onToggle} big />
            ))}
          </div>
        ))}
        {items.length === 0 && <div className="empty" style={{ color: 'var(--ink)' }}>品目がありません。下から追加できます</div>}
      </div>
      <form className="foot shop-add" onSubmit={e => { e.preventDefault(); const l = splitLabels(text); if (l.length) { onAdd(l); setText(''); } }}>
        <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="買い忘れを追加（読点で区切って複数）" />
        <button className="btn white">追加</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- 買い物リスト（パネル）

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="overlay side" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <h3><Icon name="cart" />{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる"><Icon name="close" size={20} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function ShoppingPanel({ state, groupFilter, onClose, reload, onShoppingDone, notify }: {
  state: State; groupFilter: string; onClose: () => void; reload: () => Promise<void> | void;
  onShoppingDone: () => void; notify: (m: string) => void;
}) {
  const groups = new Map(state.groups.map(g => [g.id, g]));
  const lists = state.tasks.filter(t => t.kind === 'shopping' && t.status === 'ready' && isFor(t, state.me!.id, state) && (groupFilter === 'all' || t.group_id === groupFilter));
  const open = lists.filter(t => !t.done_at);
  const done = lists.filter(t => t.done_at).slice(0, 5);
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState(groupFilter !== 'all' ? groupFilter : state.groups.find(g => g.is_personal)!.id);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<string | null>(null); // 買い物モードで開いているリスト
  const [showDone, setShowDone] = useState<Record<string, boolean>>({});

  async function toggle(it: Item) {
    const r = await api<{ completed: boolean }>(`items/${it.id}`, 'PATCH', { checked: !it.checked });
    await reload();
    if (r.completed) { setMode(null); notify('全部そろいました！ 買い物完了 🎉'); onShoppingDone(); }
  }
  async function add(taskId: string, labels: string[]) {
    if (!labels.length) return;
    await api(`tasks/${taskId}/items`, 'POST', { labels });
    reload();
  }
  async function create() {
    if (!newName.trim()) return;
    // 買い物リストは家族などで一緒に使うので、グループでは「共通（全員）」で作る
    await api('tasks', 'POST', { title: newName, kind: 'shopping', group_id: newGroup, date: null, assignees: 'all' });
    setNewName('');
    reload();
  }
  async function copyText(t: Task, items: Item[]) {
    const lines = byAisle(items.filter(i => !i.checked)).flatMap(({ aisle, items: its }) => [`【${aisle}】`, ...its.map(i => `・${i.label}`)]);
    const text = `${t.title}\n${lines.join('\n')}`;
    try { await navigator.clipboard.writeText(text); notify('テキストでコピーしました（LINE などに貼れます）'); }
    catch { notify('コピーできませんでした'); }
  }
  async function clearChecked(t: Task) {
    await api(`tasks/${t.id}/items/clear-checked`, 'POST', {});
    notify('チェック済みを片付けました');
    reload();
  }

  const modeTask = mode ? lists.find(t => t.id === mode) : null;

  const renderList = (t: Task) => {
    const g = groups.get(t.group_id);
    const shared = !!g && !g.is_personal;
    const items = state.items.filter(i => i.task_id === t.id);
    const unchecked = items.filter(i => !i.checked);
    const checked = items.filter(i => i.checked);
    const suggestions = !t.done_at ? frequentItems(state, items) : [];
    return (
      <div key={t.id} className="card shop-card" style={{ borderLeft: `5px solid ${t.color || g?.color}` }}>
        <div className="row">
          <h4>{t.title}</h4>
          <span className="small muted">{t.done_at ? '完了' : `残り${unchecked.length}`}{shared ? ` ・${g!.name}` : ''}</span>
        </div>
        {t.date && <div className="small muted">{fmtJpDate(t.date)}{t.time ? ` ${t.time}` : ''}</div>}
        {!t.done_at && items.length > 0 && (
          <div className="row wrap shop-tools">
            <button className="btn primary small" onClick={() => setMode(t.id)}><Icon name="cart" size={16} />買い物モード</button>
            <button className="btn small" onClick={() => copyText(t, items)}>テキストでコピー</button>
            {checked.length > 0 && <button className="btn small" onClick={() => clearChecked(t)}>チェック済みを片付ける</button>}
          </div>
        )}
        {/* まだ買っていないものを売り場ごとに */}
        {byAisle(unchecked).map(({ aisle, items: its }) => (
          <div key={aisle} className="shop-aisle">
            <div className="shop-aisle-name">{aisle}</div>
            {its.map(it => <ItemRow key={it.id} state={state} it={it} shared={shared} onToggle={toggle}
              onDelete={async x => { await api(`items/${x.id}`, 'DELETE'); reload(); }} />)}
          </div>
        ))}
        {checked.length > 0 && (
          <button className="shop-done-toggle" onClick={() => setShowDone(x => ({ ...x, [t.id]: !x[t.id] }))}>
            チェック済み {checked.length} {showDone[t.id] ? '▲' : '▼'}
          </button>
        )}
        {showDone[t.id] && checked.map(it => <ItemRow key={it.id} state={state} it={it} shared={shared} onToggle={toggle}
          onDelete={async x => { await api(`items/${x.id}`, 'DELETE'); reload(); }} />)}
        {!t.done_at && (
          <>
            <div className="row" style={{ marginTop: 8 }}>
              <input type="text" placeholder="品目を追加（例：卵 2、牛乳）" value={texts[t.id] || ''}
                onChange={e => setTexts(x => ({ ...x, [t.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { add(t.id, splitLabels(texts[t.id] || '')); setTexts(x => ({ ...x, [t.id]: '' })); } }} />
              <button className="btn small" onClick={() => { add(t.id, splitLabels(texts[t.id] || '')); setTexts(x => ({ ...x, [t.id]: '' })); }}>追加</button>
            </div>
            {suggestions.length > 0 && (
              <div className="shop-suggest">
                <span className="small muted">よく買うもの</span>
                {suggestions.map(n => <button key={n} className="chip" onClick={() => add(t.id, [n])}>＋ {n}</button>)}
              </div>
            )}
          </>
        )}
        {t.done_at && (
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={async () => { await api(`tasks/${t.id}`, 'DELETE'); reload(); }}>このリストを消す</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Sheet title="買い物リスト" onClose={onClose}>
        {open.length === 0 && <div className="empty">買い物リストはありません</div>}
        {open.map(renderList)}
        <div className="card soft">
          <div className="small" style={{ marginBottom: 8 }}>＋ 新しい買い物リスト</div>
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
      {modeTask && <ShoppingMode state={state} task={modeTask} onClose={() => setMode(null)} onToggle={toggle} onAdd={l => add(modeTask.id, l)} />}
    </>
  );
}
