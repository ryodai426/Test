// 画面の枠まわりで使う線のアイコン（絵文字より落ち着いた見た目にするため）
const PATHS: Record<string, string> = {
  menu: 'M4 7h16M4 12h16M4 17h10',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.9 1.1L15 20.5h-4l-.3-2a7 7 0 0 1-1.9-1.1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3L4.9 9.3l2-3.4 1.9.7a7 7 0 0 1 1.9-1.1l.3-2h4l.3 2a7 7 0 0 1 1.9 1.1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z',
  memo: 'M8 4h8l3 3v13H5V4h3zM8 4v3h8M8.5 12h7M8.5 16h4.5',
  cart: 'M3 4h2.5l2.2 10.5h10l2-7.5H6.5M9.5 19.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 19.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  pack: 'M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7M5 10a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10H5V10zM9 13h6v3H9z',
  calendar: 'M5 6h14v14H5zM5 10h14M9 3.5V7M15 3.5V7',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13',
};

export default function Icon({ name, size = 22, stroke = 1.8 }: { name: keyof typeof PATHS | string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** ロゴ：山と、てっぺんの旗（=忘れないための目印） */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flex: 'none' }}>
      <rect width="32" height="32" rx="9" style={{ fill: 'var(--sun)' }} />
      <path d="M4 25l8.5-12 4.5 6 3.5-4.5L28 25z" style={{ fill: 'var(--forest)' }} />
      <path d="M20.5 14.5V6.5l5 2.2-5 2.2" fill="none" style={{ stroke: 'var(--forest)' }} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
