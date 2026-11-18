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

/** ロゴ：緑の丸に、山と太陽（線画） */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="20" cy="20" r="20" style={{ fill: 'var(--green)' }} />
      <circle cx="27" cy="13" r="4.2" style={{ fill: 'var(--yellow)', stroke: 'var(--ink)' }} strokeWidth="1.8" />
      <path d="M6.5 29 15 16.5l5 7 3.5-4.5L33.5 29z" style={{ fill: '#fff', stroke: 'var(--ink)' }} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12.6 20l2.4 2 2-1.6" fill="none" style={{ stroke: 'var(--ink)' }} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 丘・雲・太陽・テント・木の絵。onGreen は緑の面の上で使うとき */
export function Scene({ onGreen = false, className = 'scene' }: { onGreen?: boolean; className?: string }) {
  const ink = { stroke: 'var(--ink)', strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const back = onGreen ? 'var(--green-2)' : 'var(--green-pale)';
  const front = onGreen ? 'var(--cream)' : 'var(--green)';
  const cloud = (x: number, y: number, k = 1) => (
    <g transform={`translate(${x} ${y}) scale(${k})`} style={{ fill: '#fff' }}>
      <circle cx="0" cy="10" r="14" /><circle cx="18" cy="2" r="18" /><circle cx="40" cy="8" r="15" /><rect x="-14" y="10" width="70" height="14" rx="7" />
    </g>
  );
  const tree = (x: number, y: number, k = 1) => (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      <path d="M0 0v12" {...ink} fill="none" />
      <path d="M-14 2 0-30 14 2z" style={{ fill: onGreen ? 'var(--green)' : 'var(--green-2)' }} {...ink} />
      <path d="M-5-10l5 4 5-4" fill="none" {...ink} strokeWidth={1.6} />
    </g>
  );
  return (
    <svg className={className} viewBox="0 0 600 220" preserveAspectRatio="xMidYMax meet" aria-hidden="true" style={{ overflow: 'visible' }}>
      <circle cx="478" cy="62" r="28" style={{ fill: 'var(--yellow)' }} {...ink} />
      {cloud(92, 40)}
      {cloud(360, 70, .8)}
      <path d="M-2400 140H0C110 92 230 104 330 138S520 104 600 116H3000V220H-2400z" style={{ fill: back }} />
      <path d="M-2400 176H0C110 150 210 158 310 174S500 146 600 160H3000V220H-2400z" style={{ fill: front }} />
      <g>
        <path d="M150 174 203 104l53 70z" style={{ fill: 'var(--coral)' }} {...ink} />
        <path d="M203 130l-14 44h28z" style={{ fill: 'var(--lilac)' }} {...ink} />
        <path d="M203 104V84" {...ink} fill="none" />
        <path d="M203 84l18 6-18 6z" style={{ fill: 'var(--yellow)' }} {...ink} />
      </g>
      {tree(300, 168, 1)}
      {tree(330, 172, .8)}
      {tree(540, 158, 1.1)}
      <path d="M262 52q6-6 12 0q6-6 12 0M300 34q5-5 10 0q5-5 10 0" fill="none" {...ink} strokeWidth={1.8} />
      <g style={{ fill: 'var(--sky)' }}><circle cx="96" cy="190" r="4" /><circle cx="440" cy="196" r="4" /></g>
      <g style={{ fill: 'var(--yellow)' }}><circle cx="120" cy="200" r="4" /><circle cx="470" cy="186" r="4" /></g>
    </svg>
  );
}
