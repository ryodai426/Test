// 絵文字を、影もグラデーションもない「のっぺりした2Dイラスト」で描き直したもの。
// 端末ごとに見た目が変わらないよう、アプリ内で使う絵文字はすべてここを通す。
// 色は参考サイトの色、線は丘のイラストと同じ細い墨色の線。

const INK = '#2C2E2A';
const C = { green: '#8ED462', yellow: '#F5E211', coral: '#FF705D', sky: '#2BA0FF', lilac: '#EBC1FF', peach: '#FFBE9F', brown: '#BF5622', cream: '#F5F1E4', white: '#FFFFFF' };
const s = { stroke: INK, strokeWidth: 1.8, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
const line = { ...s, fill: 'none' };

const DRAW: Record<string, React.ReactNode> = {
  // 📝 メモ
  '📝': (<>
    <rect x="5" y="4" width="18" height="24" rx="3" fill={C.white} {...s} />
    <path d="M9.5 10h9M9.5 14.5h9M9.5 19h5" {...line} />
    <path d="M27.5 9.5l-9.8 9.8-3.6 1.1 1.1-3.6 9.8-9.8z" fill={C.yellow} {...s} />
    <path d="M23.4 8.6l2.5 2.5" {...line} />
  </>),
  // 👥 会議（ふたり）
  '👥': (<>
    <circle cx="21.5" cy="11" r="4.2" fill={C.peach} {...s} />
    <path d="M14 27c0-5 3.3-8.2 7.5-8.2S29 22 29 27z" fill={C.coral} {...s} />
    <circle cx="11.5" cy="12" r="4.6" fill={C.peach} {...s} />
    <path d="M3 28c0-5.4 3.7-8.8 8.5-8.8S20 22.6 20 28z" fill={C.sky} {...s} />
  </>),
  // 🌅 当番（朝日）
  '🌅': (<>
    <path d="M7.5 21a8.5 8.5 0 0 1 17 0z" fill={C.yellow} {...s} />
    <path d="M16 5.5v3.5M6 10l2.4 2.4M26 10l-2.4 2.4M2.8 17h3M26.2 17h3" {...line} />
    <path d="M3 21h26v6H3z" fill={C.green} {...s} />
    <path d="M8 24.5h5M17 24.5h7" {...line} strokeWidth={1.5} />
  </>),
  // 🛒 買い物
  '🛒': (<>
    <path d="M3 6h3.5l3 14h14.5l2.8-10H8" fill="none" {...s} />
    <path d="M8.3 10h18.5l-2.8 10H10.4z" fill={C.green} {...s} />
    <circle cx="12" cy="25" r="2.2" fill={C.white} {...s} />
    <circle cx="22" cy="25" r="2.2" fill={C.white} {...s} />
  </>),
  // ⏰ 目覚まし
  '⏰': (<>
    <path d="M4.5 9.5a4.5 4.5 0 0 1 6-5.2M27.5 9.5a4.5 4.5 0 0 0-6-5.2" fill={C.yellow} {...s} />
    <path d="M9 27l2-2.6M23 27l-2-2.6" {...line} />
    <circle cx="16" cy="17" r="10" fill={C.coral} {...s} />
    <circle cx="16" cy="17" r="7" fill={C.white} {...s} strokeWidth={1.4} />
    <path d="M16 12.5V17l3 2" {...line} />
  </>),
  // 🔔 お知らせ
  '🔔': (<>
    <path d="M8 21v-6.5a8 8 0 0 1 16 0V21l2.5 3h-21z" fill={C.yellow} {...s} />
    <path d="M13 26.5a3 3 0 0 0 6 0" fill={C.yellow} {...s} />
    <path d="M16 4.5v2" {...line} />
    <path d="M11.5 13.5a4.5 4.5 0 0 1 3-3.8" {...line} strokeWidth={1.5} />
  </>),
  // 📋 未記入メモ（クリップボード）
  '📋': (<>
    <rect x="5.5" y="5.5" width="21" height="23" rx="3" fill={C.brown} {...s} />
    <rect x="8.5" y="8.5" width="15" height="17" rx="1.5" fill={C.white} {...s} strokeWidth={1.4} />
    <rect x="11.5" y="3.5" width="9" height="5" rx="2" fill={C.cream} {...s} />
    <path d="M11.5 14h9M11.5 18h9M11.5 22h5" {...line} strokeWidth={1.5} />
  </>),
  // 🎉 クラッカー
  '🎉': (<>
    <path d="M4 28l5-15 10 10z" fill={C.yellow} {...s} />
    <path d="M7.3 18.3l6.4 6.4" {...line} strokeWidth={1.5} />
    <path d="M14.5 12.5c1-3 3.5-4 5-6M19.5 17.5c3-1 4-3.5 6-5" {...line} />
    <circle cx="23" cy="6" r="1.8" fill={C.coral} {...s} strokeWidth={1.4} />
    <circle cx="27" cy="17" r="1.8" fill={C.sky} {...s} strokeWidth={1.4} />
    <path d="M17 4.5l1.5 1.5M26 10l1.8-.6M21 23l1.6 1.2" stroke={C.coral} strokeWidth={2.2} strokeLinecap="round" />
    <path d="M13 7l.6 2M27.5 23l-1.8.4" stroke={C.sky} strokeWidth={2.2} strokeLinecap="round" />
  </>),
  // ✨ きらきら
  '✨': (<>
    <path d="M13 4c.9 5.6 2.4 7.1 8 8-5.6.9-7.1 2.4-8 8-.9-5.6-2.4-7.1-8-8 5.6-.9 7.1-2.4 8-8z" fill={C.yellow} {...s} />
    <path d="M23.5 17c.5 3 1.3 3.8 4.3 4.3-3 .5-3.8 1.3-4.3 4.3-.5-3-1.3-3.8-4.3-4.3 3-.5 3.8-1.3 4.3-4.3z" fill={C.lilac} {...s} />
    <circle cx="7" cy="25" r="1.8" fill={C.sky} {...s} strokeWidth={1.4} />
  </>),
  // 💬 ふきだし
  '💬': (<>
    <path d="M5 7.5A3.5 3.5 0 0 1 8.5 4h15A3.5 3.5 0 0 1 27 7.5v10a3.5 3.5 0 0 1-3.5 3.5H14l-6 5.5V21h.5A3.5 3.5 0 0 1 5 17.5z" fill={C.lilac} {...s} />
    <circle cx="11" cy="12.5" r="1.4" fill={INK} /><circle cx="16" cy="12.5" r="1.4" fill={INK} /><circle cx="21" cy="12.5" r="1.4" fill={INK} />
  </>),
  // 👍 いいね
  '👍': (<>
    <rect x="3.5" y="14" width="5.5" height="13" rx="1.5" fill={C.sky} {...s} />
    <path d="M9 15.5l4.5-6.8c.6-.9.9-2 .9-3.1V5c0-1 .8-1.6 1.7-1.4 1.9.4 3 2.3 2.5 4.2L17.6 12h6.6a2.6 2.6 0 0 1 2.5 3.3l-2.6 9.4A3 3 0 0 1 21.2 27H9z" fill={C.peach} {...s} />
  </>),
  // ❤️ ハート
  '❤️': (<>
    <path d="M16 27.5S3.5 20 3.5 11.8A6.3 6.3 0 0 1 16 9a6.3 6.3 0 0 1 12.5 2.8C28.5 20 16 27.5 16 27.5z" fill={C.coral} {...s} />
    <path d="M8 11.5a3 3 0 0 1 2.5-2.6" {...line} stroke={C.white} strokeWidth={2} />
  </>),
  // 💪 がんばれ
  '💪': (<>
    <path d="M4 27.5c1-6.5 3-11 6.5-14.5l3-6.5c.8-1.7 2.7-2.4 4.4-1.6 1.5.7 1.8 2.6.9 4L16.5 12c4-1.8 8.8-.6 10.7 3.2 1.8 3.6.6 8-3 10-3.8 2.1-9.5 2.6-20.2 2.3z" fill={C.peach} {...s} />
    <path d="M16.5 12c-.8 2.2-.6 4.6.6 6.4M21 18.5c-1.6.4-3 1.6-3.6 3" {...line} strokeWidth={1.5} />
  </>),
  // 👏 拍手
  '👏': (<>
    <path transform="translate(-3.5 1.5) rotate(-16 14 20)" d="M9 26.5l-3.8-8.8c-.5-1.2 0-2.5 1.2-3s2.5 0 3 1.2l1 2.3-3.3-7.7c-.5-1.2 0-2.5 1.2-3s2.5 0 3 1.2l2.6 6-3.4-8c-.5-1.2 0-2.5 1.2-3s2.5 0 3 1.2l3.8 8.8.2-3.2c.1-1.3 1.2-2.2 2.5-2 1.2.1 2 1.2 2 2.4l-.6 8.6c-.3 4.6-4 8-8.6 8z" fill={C.peach} {...s} />
    <path d="M9 26.5l-3.8-8.8c-.5-1.2 0-2.5 1.2-3s2.5 0 3 1.2l1 2.3-3.3-7.7c-.5-1.2 0-2.5 1.2-3s2.5 0 3 1.2l2.6 6-3.4-8c-.5-1.2 0-2.5 1.2-3s2.5 0 3 1.2l3.8 8.8.2-3.2c.1-1.3 1.2-2.2 2.5-2 1.2.1 2 1.2 2 2.4l-.6 8.6c-.3 4.6-4 8-8.6 8z" fill={C.peach} {...s} />
    <path d="M24.5 6.5l1.5-2.5M27 10l2.6-1M27.5 14.5h2.8" stroke={C.yellow} strokeWidth={2.4} strokeLinecap="round" />
  </>),
  // 🔒 鍵
  '🔒': (<>
    <path d="M10.5 14V10a5.5 5.5 0 0 1 11 0v4" fill="none" {...s} strokeWidth={2.2} />
    <rect x="6.5" y="14" width="19" height="14" rx="3" fill={C.yellow} {...s} />
    <circle cx="16" cy="20" r="1.8" fill={INK} />
    <path d="M16 21v3" {...line} />
  </>),
  // 💻 パソコン
  '💻': (<>
    <rect x="6" y="7" width="20" height="14" rx="2" fill={C.sky} {...s} />
    <path d="M9.5 10.5h7" {...line} stroke={C.white} strokeWidth={1.6} />
    <path d="M3 24h26l-1.5 3h-23z" fill={C.cream} {...s} />
  </>),
};

const ALIAS: Record<string, string> = { '❤': '❤️' };
export const EMOJI_CHARS = Object.keys(DRAW);

export default function Emoji({ char, size = 20, label }: { char: string; size?: number; label?: string }) {
  const key = ALIAS[char] || char;
  const art = DRAW[key];
  if (!art) return <span>{char}</span>;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={label || key}
      style={{ display: 'inline-block', verticalAlign: '-0.2em', flex: 'none', overflow: 'visible' }}>
      {art}
    </svg>
  );
}

const SPLIT = new RegExp(`(${[...EMOJI_CHARS, '❤'].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\uFE0F?`, 'u');

/** 文の中の絵文字だけをイラストに差し替えて表示する（お知らせ文など） */
export function EmojiText({ text, size = 18 }: { text: string; size?: number }) {
  const parts = text.split(SPLIT);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <Emoji key={i} char={p} size={size} /> : p))}
    </>
  );
}
