import React from 'react';

type IconProps = { className?: string };

const base = {
  width: 15,
  height: 15,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="6" className="mark-bg" />
      <path d="M6 9V6h3M18 9V6h-3M6 15v3h3M18 15v3h-3" className="mark-frame" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M10.5 10 8.5 12l2 2M13.5 10l2 2-2 2" className="mark-code" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const Check = (p: IconProps) => (
  <svg {...base} {...p} strokeWidth={1.8}><path d="m3.5 8.5 3 3 6-7" /></svg>
);
export const Copy = (p: IconProps) => (
  <svg {...base} {...p}><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" /><path d="M3 10.5V3.8C3 3.3 3.3 3 3.8 3h6.7" /></svg>
);
export const External = (p: IconProps) => (
  <svg {...base} {...p}><path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5v3c0 .6-.4 1-1 1h-7c-.6 0-1-.4-1-1v-7c0-.6.4-1 1-1h3" /></svg>
);
export const Search = (p: IconProps) => (
  <svg {...base} {...p} strokeWidth={1.5}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
);
export const Lock = (p: IconProps) => (
  <svg {...base} {...p}><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></svg>
);
export const Repo = (p: IconProps) => (
  <svg {...base} {...p} strokeWidth={1.3}><path d="M4 2.5h8.5v9H4.8c-.7 0-1.3.6-1.3 1.3V3.5c0-.6.4-1 1-1ZM3.5 12.8c0 .6.6 1.2 1.3 1.2h7.7" /></svg>
);
export const Branch = (p: IconProps) => (
  <svg {...base} {...p} strokeWidth={1.3}><circle cx="5" cy="3.5" r="1.5" /><circle cx="5" cy="12.5" r="1.5" /><circle cx="11" cy="5.5" r="1.5" /><path d="M5 5v6M11 7c0 2.5-2 3-6 4" /></svg>
);
export const File = (p: IconProps) => (
  <svg {...base} {...p} strokeWidth={1.3}><path d="M4 2h5l3 3v9H4zM9 2v3h3" /></svg>
);
export const Shield = (p: IconProps) => (
  <svg {...base} {...p} strokeWidth={1.3}><path d="M8 2 3 4v4c0 3 2.2 5 5 6 2.8-1 5-3 5-6V4L8 2Z" /></svg>
);
export const Alert = (p: IconProps) => (
  <svg {...base} {...p}><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 10.8v.2" strokeWidth={1.6} /></svg>
);
export const Refresh = (p: IconProps) => (
  <svg {...base} {...p}><path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5" /></svg>
);
export const Cursor = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4 3l11 6-5 1.5L8 16 4 3Z" className="cursor-fill" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);
