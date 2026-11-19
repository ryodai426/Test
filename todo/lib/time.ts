// サーバーとブラウザの両方で使う、日付・繰り返し・リマインドの計算
// 日付は 'YYYY-MM-DD'、時刻は 'HH:MM' の文字列で扱う（タイムゾーンのずれを避けるため）

export type Repeat = {
  freq: 'daily' | 'weekly' | 'monthly';
  interval?: number;          // 2 なら「2週間に1回」など
  weekdays?: number[];        // 0=日 … 6=土（weekly のとき）
  monthMode?: 'day' | 'nth';  // 毎月○日 / 毎月第n○曜日
  until?: string | null;
  except?: string[];          // 繰り返しから外した日（「この日だけ」変更・削除した日）
};

export type TaskLike = {
  id: string;
  date: string | null;
  end_date?: string | null;  // 複数日の予定の最後の日（出張など。繰り返しとは一緒に使わない）
  time: string | null;
  repeat: Repeat | null;
  reminders: string[];
};

const DAY = 86400000;

export function parseDate(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(s: string, n: number): string {
  return fmtDate(parseDate(s) + n * DAY);
}

export function weekday(s: string): number {
  return new Date(parseDate(s)).getUTCDay();
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY);
}

/** その日に、このタスクがあるか */
export function occursOn(t: Pick<TaskLike, 'date' | 'repeat' | 'end_date'>, day: string): boolean {
  if (!t.date) return false;
  if (!t.repeat) return t.end_date && t.end_date > t.date ? day >= t.date && day <= t.end_date : t.date === day;
  if (day < t.date) return false;
  if (t.repeat.until && day > t.repeat.until) return false;
  if (t.repeat.except?.includes(day)) return false;
  const interval = Math.max(1, t.repeat.interval || 1);
  const diff = daysBetween(t.date, day);
  switch (t.repeat.freq) {
    case 'daily':
      return diff % interval === 0;
    case 'weekly': {
      const days = t.repeat.weekdays && t.repeat.weekdays.length ? t.repeat.weekdays : [weekday(t.date)];
      if (!days.includes(weekday(day))) return false;
      // 週の始まり（日曜）同士で何週離れているか
      const w0 = parseDate(t.date) - weekday(t.date) * DAY;
      const w1 = parseDate(day) - weekday(day) * DAY;
      return Math.round((w1 - w0) / (7 * DAY)) % interval === 0;
    }
    case 'monthly': {
      const a = new Date(parseDate(t.date));
      const b = new Date(parseDate(day));
      const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
      if (months % interval !== 0) return false;
      if (t.repeat.monthMode === 'nth') {
        const nth = Math.ceil(a.getUTCDate() / 7);
        return b.getUTCDay() === a.getUTCDay() && Math.ceil(b.getUTCDate() / 7) === nth;
      }
      return b.getUTCDate() === a.getUTCDate();
    }
  }
  return false;
}

/** 指定タイムゾーンで、いまの日付と時刻 */
export function nowIn(tz: string, at = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const g = (k: string) => parts.find(p => p.type === k)?.value || '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

/** タイムゾーン tz の「日付＋時刻」を UTC の時刻（ms）にする */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [h, m] = time.split(':').map(Number);
  const guess = parseDate(date) + (h * 60 + m) * 60000;
  const local = nowIn(tz, new Date(guess));
  const [lh, lm] = local.time.split(':').map(Number);
  const asIf = parseDate(local.date) + (lh * 60 + lm) * 60000;
  return guess - (asIf - guess);
}

export const REMINDER_LABELS: Record<string, string> = {
  eve: '前日20:00',
  '60': '1時間前',
  '30': '30分前',
  '10': '10分前',
  '5': '5分前',
  '0': '時間ちょうど',
};
/** 入力画面で選べる通知。時間ちょうどは選ばなくても、時刻のある予定すべてで自動で鳴らす（1時間前・10分前は前に入れた予定だけ） */
export const REMINDER_CHOICES = ['eve', '30', '5'];

/** 種類を選ぶだけで、通知のタイミングが自動で決まる（入力の手間を減らす） */
export const KIND_PRESETS: Record<string, { label: string; icon: string; reminders: string[] }> = {
  general: { label: '一般', icon: '📝', reminders: [] },
  meeting: { label: '会議', icon: '👥', reminders: ['30', '5'] },
  duty: { label: '当番', icon: '🌅', reminders: ['eve', '30'] },
  shopping: { label: '買い物', icon: '🛒', reminders: [] },
  reminder: { label: 'リマインダー', icon: '⏰', reminders: [] },
};

/** タイトルが空の予定の呼び名：自分たちで足した種類ならその名前、一般なら「予定」、ほかは種類の名前 */
export function titleOr(t: { title: string; kind: string }, kindName?: string | null): string {
  if (t.title) return t.title;
  if (kindName) return kindName;
  return !t.kind || t.kind === 'general' ? '予定' : KIND_PRESETS[t.kind]?.label || '予定';
}

export function reminderMessage(title: string, key: string, time: string): string {
  if (key === 'eve') return `明日は「${title}」です（${time}）`;
  if (key === '0') return `「${title}」の時間です！`;
  return `${REMINDER_LABELS[key] ? REMINDER_LABELS[key].replace('前', '後') : key + '分後'}に「${title}」です（${time}）`;
}

/** あるタスクの、ある日の分のリマインドが鳴る時刻（UTC ms） */
export function reminderTimes(t: TaskLike, day: string, tz: string): { key: string; at: number }[] {
  if (!t.time) return [];
  const start = zonedToUtc(day, t.time, tz);
  // 時間ちょうどは、どの予定でも必ず鳴らす
  return [...new Set([...(t.reminders || []), '0'])].map(key => ({
    key,
    at: key === 'eve' ? zonedToUtc(addDays(day, -1), '20:00', tz) : start - Number(key) * 60000,
  }));
}

/** 未記入メモの段階的リマインド（2分→5分→10分） */
export const DRAFT_STEPS = [
  { min: 2, text: (t: string) => (t ? `「${t}」の続き、いま書いておきますか？` : 'さっきのメモ、詳細を入力しますか？') },
  { min: 5, text: (t: string) => (t ? `「${t}」がまだ未記入です` : '未記入のメモがあります') },
  { min: 10, text: (t: string) => (t ? `未記入：「${t}」いつやるか決めてください` : '未記入のメモ：詳細を入力してください') },
];

export const WEEK_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
