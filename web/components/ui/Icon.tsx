/** Linien-Icons der Oberfläche (eigene Zeichnung, docs/DESIGN.md 7). Immer dekorativ, Beschriftung trägt das Element. */
const PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 21 21" /></>,
  pin: <><path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z" /><circle cx="12" cy="10" r="2" /></>,
  message: <path d="M4 5h16v11H9l-5 4z" />,
  bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h16M14 6l6 6-6 6" />,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="1" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  flag: <path d="M5 21V4h11l-1.5 4L16 12H5" />,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21h4" /></>,
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8 11l8-4M8 13l8 4" /></>,
  logout: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  download: <><path d="M12 4v11M7 10l5 5 5-5" /><path d="M5 20h14" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  block: <><circle cx="12" cy="12" r="8" /><path d="M6.5 6.5l11 11" /></>,
  scale: <><path d="M12 4v16M7 20h10M5 8h14" /><path d="M5 8l-2 6h4zM19 8l-2 6h4z" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  offline: <path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5v.5M3 3l18 18" />,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  shieldAdmin: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M12 8v5M12 16v.5" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {PATHS[name]}
    </svg>
  );
}
