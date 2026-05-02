import type { CSSProperties, SVGProps } from "react";

export type IconName =
  | "home" | "target" | "brain" | "users" | "skills" | "plug" | "activity"
  | "settings" | "inbox" | "search" | "plus" | "arrow" | "bell" | "cmd"
  | "play" | "pause" | "check" | "chev" | "chevd" | "book" | "money" | "grid"
  | "zap" | "flag" | "git" | "sun" | "filter" | "sort" | "eye" | "msg"
  | "code" | "dot" | "list" | "kanban" | "spark" | "file" | "sandbox"
  | "mic" | "sparkle";

type IProps = Omit<SVGProps<SVGSVGElement>, "name" | "stroke"> & {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
};

export const I = ({ name, size = 14, stroke = 1.5, ...rest }: IProps) => {
  const common: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...rest,
  };
  const paths: Record<IconName, JSX.Element> = {
    home: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></>,
    brain: <><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3 3 3 0 0 0 6 0 3 3 0 0 0 3-3 3 3 0 0 0 2-5 3 3 0 0 0-2-5 3 3 0 0 0-3-3 3 3 0 0 0-6 0Z" /><path d="M9 8v8M15 8v8M9 12h6" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.5" /><path d="M15 14c2.8 0 6 1.7 6 5" /></>,
    skills: <><path d="M4 4h16v6H4zM4 14h10v6H4zM18 14h2v6h-2z" /></>,
    plug: <><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0z" /><path d="M12 18v4" /></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.4-.9a7 7 0 0 0 2 1.2L10 21h4l.5-2.5a7 7 0 0 0 2-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" /></>,
    inbox: <><path d="M3 12l3-8h12l3 8M3 12v8h18v-8M3 12h6l1 2h4l1-2h6" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 9H3c0-1 3-2 3-9z" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
    cmd: <><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" /></>,
    play: <><path d="M6 4l14 8-14 8z" /></>,
    pause: <><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></>,
    check: <><path d="M5 12l5 5L20 7" /></>,
    chev: <><path d="M9 6l6 6-6 6" /></>,
    chevd: <><path d="M6 9l6 6 6-6" /></>,
    book: <><path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z" /><path d="M4 17a3 3 0 0 1 3-3h11" /></>,
    money: <><path d="M5 7h14v10H5zM12 9v6M9 12h6" /></>,
    grid: <><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" /></>,
    zap: <><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></>,
    flag: <><path d="M5 4v18M5 4h11l-2 4 2 4H5" /></>,
    git: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M6 8v8M8 6c5 0 5 6 8 6" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    filter: <><path d="M3 5h18l-7 9v6l-4-2v-4z" /></>,
    sort: <><path d="M3 6h18M6 12h12M9 18h6" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
    msg: <><path d="M4 5h16v11H8l-4 4z" /></>,
    code: <><path d="M9 7l-5 5 5 5M15 7l5 5-5 5" /></>,
    dot: <circle cx="12" cy="12" r="3" fill="currentColor" />,
    list: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    kanban: <><rect x="3" y="3" width="6" height="14" /><rect x="11" y="3" width="6" height="10" /><rect x="19" y="3" width="2" height="8" /></>,
    spark: <><path d="M3 17l5-7 4 4 5-9 4 5" /></>,
    file: <><path d="M5 3h9l5 5v13H5z" /><path d="M14 3v5h5" /></>,
    sandbox: <><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 9h18M9 3v18" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
    sparkle: <><path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" /></>,
  };
  return <svg {...common}>{paths[name] ?? paths.dot}</svg>;
};

export type ChannelKey =
  | "slack" | "whatsapp" | "telegram" | "email" | "linear"
  | "github" | "notion" | "stripe" | "sandbox" | "sys";

export const ChannelMark = ({ ch, size = 16 }: { ch: ChannelKey | string; size?: number }) => {
  const map: Record<ChannelKey, { bg: string; fg: string; t: string }> = {
    slack: { bg: "#4A154B", fg: "#fff", t: "S" },
    whatsapp: { bg: "#1F8B4C", fg: "#fff", t: "W" },
    telegram: { bg: "#229ED9", fg: "#fff", t: "T" },
    email: { bg: "var(--bg-3)", fg: "var(--ink)", t: "@" },
    linear: { bg: "#5E6AD2", fg: "#fff", t: "L" },
    github: { bg: "#0d1117", fg: "#fff", t: "G" },
    notion: { bg: "var(--bg-3)", fg: "var(--ink)", t: "N" },
    stripe: { bg: "#635BFF", fg: "#fff", t: "$" },
    sandbox: { bg: "var(--bg-3)", fg: "var(--ink)", t: "□" },
    sys: { bg: "var(--bg-3)", fg: "var(--ink)", t: "·" },
  };
  const fallback = { bg: "var(--bg-3)", fg: "var(--ink)", t: "·" };
  const cfg = (map as Record<string, typeof fallback>)[ch] ?? fallback;
  const style: CSSProperties = {
    display: "inline-grid",
    placeItems: "center",
    width: size,
    height: size,
    borderRadius: 3,
    background: cfg.bg,
    color: cfg.fg,
    fontFamily: "var(--font-mono)",
    fontSize: size * 0.55,
    fontWeight: 600,
    flexShrink: 0,
  };
  return <span style={style}>{cfg.t}</span>;
};

export const Sigil = ({ seed = "A", size = 32 }: { seed?: string; size?: number }) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h * 31 + seed.charCodeAt(i)) >>> 0);
  const r = (n: number) => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h % n;
  };
  const variant = r(6);
  const a = 4 + r(8);
  const b = 4 + r(8);
  const stroke = "var(--ink)";
  const fillSoft = "var(--ink)";
  let inner: JSX.Element;
  if (variant === 0) {
    inner = <>
      <rect x="6" y="6" width="20" height="20" stroke={stroke} fill="none" strokeWidth="1" />
      <rect x={6 + a / 2} y={6 + a / 2} width={20 - a} height={20 - a} stroke={stroke} fill="none" strokeWidth="1" />
      <rect x="14" y="14" width="4" height="4" fill={fillSoft} />
    </>;
  } else if (variant === 1) {
    inner = <>
      <circle cx="16" cy="16" r="9" stroke={stroke} fill="none" strokeWidth="1" />
      <line x1="6" y1="16" x2="26" y2="16" stroke={stroke} strokeWidth="1" />
      <line x1="16" y1="6" x2="16" y2="26" stroke={stroke} strokeWidth="1" />
      <circle cx="16" cy="16" r="2" fill={fillSoft} />
    </>;
  } else if (variant === 2) {
    inner = <>
      <polygon points={`16,5 ${27},${22} 5,${22}`} stroke={stroke} fill="none" strokeWidth="1" />
      <line x1="16" y1="5" x2="16" y2="22" stroke={stroke} strokeWidth="1" />
      <circle cx="16" cy={16 + b / 3} r="1.5" fill={fillSoft} />
    </>;
  } else if (variant === 3) {
    inner = <>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} x={5 + i * 3}
              y={16 - (3 + ((seed.charCodeAt(i % seed.length) + i) % 9))}
              width="2"
              height={6 + ((seed.charCodeAt(i % seed.length) + i) % 12)}
              fill={fillSoft} />
      ))}
    </>;
  } else if (variant === 4) {
    inner = <>
      {[6, 12, 18, 24].flatMap((y) => [6, 12, 18, 24].map((x) => (
        <circle key={`${x}-${y}`} cx={x} cy={y}
                r={(x + y + a) % 5 < 2 ? 1.6 : 0.8} fill={fillSoft} />
      )))}
    </>;
  } else {
    inner = <>
      <rect x="5" y="5" width="22" height="22" stroke={stroke} fill="none" strokeWidth="1" />
      <path d={`M5 ${5 + a} L${27} 5`} stroke={stroke} strokeWidth="1" />
      <path d={`M5 27 L${5 + b} 27 L27 ${27 - a}`} stroke={stroke} fill="none" strokeWidth="1" />
      <circle cx="20" cy="14" r="1.5" fill={fillSoft} />
    </>;
  }
  return <svg viewBox="0 0 32 32" width={size} height={size}>{inner}</svg>;
};
