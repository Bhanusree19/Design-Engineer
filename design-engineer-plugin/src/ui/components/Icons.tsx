import React from 'react';

type IconProps = { className?: string; style?: React.CSSProperties };

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

export const Check = (p: IconProps) => <svg {...base} {...p} strokeWidth={1.8}><path d="m3.5 8.5 3 3 6-7" /></svg>;
export const Copy = (p: IconProps) => <svg {...base} {...p}><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" /><path d="M3 10.5V3.8C3 3.3 3.3 3 3.8 3h6.7" /></svg>;
export const External = (p: IconProps) => <svg {...base} {...p}><path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5v3c0 .6-.4 1-1 1h-7c-.6 0-1-.4-1-1v-7c0-.6.4-1 1-1h3" /></svg>;
export const Search = (p: IconProps) => <svg {...base} {...p} strokeWidth={1.5}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>;
export const Lock = (p: IconProps) => <svg {...base} {...p}><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></svg>;
export const Repo = (p: IconProps) => <svg {...base} {...p} strokeWidth={1.3}><path d="M4 2.5h8.5v9H4.8c-.7 0-1.3.6-1.3 1.3V3.5c0-.6.4-1 1-1ZM3.5 12.8c0 .6.6 1.2 1.3 1.2h7.7" /></svg>;
export const Branch = (p: IconProps) => <svg {...base} {...p} strokeWidth={1.3}><circle cx="5" cy="3.5" r="1.5" /><circle cx="5" cy="12.5" r="1.5" /><circle cx="11" cy="5.5" r="1.5" /><path d="M5 5v6M11 7c0 2.5-2 3-6 4" /></svg>;
export const Shield = (p: IconProps) => <svg {...base} {...p} strokeWidth={1.3}><path d="M8 2 3 4v4c0 3 2.2 5 5 6 2.8-1 5-3 5-6V4L8 2Z" /></svg>;
export const Alert = (p: IconProps) => <svg {...base} {...p}><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 10.8v.2" strokeWidth={1.6} /></svg>;
export const Mail = (p: IconProps) => <svg {...base} {...p}><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="m2.5 4.5 5.5 4 5.5-4" /></svg>;
export const Eye = (p: IconProps) => <svg {...base} {...p} strokeWidth={1.3}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></svg>;
export const EyeOff = (p: IconProps) => <svg {...base} {...p} strokeWidth={1.3}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><path d="m2.5 2.5 11 11" /></svg>;
export const Refresh = (p: IconProps) => <svg {...base} {...p}><path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5" /></svg>;
export const Back = (p: IconProps) => <svg {...base} {...p} strokeWidth={1.6} width={16} height={16}><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>;
export const Plus = (p: IconProps) => <svg {...base} {...p} strokeWidth={1.6}><path d="M8 3v10M3 8h10" /></svg>;
export const More = (p: IconProps) => (
  <svg {...base} {...p} stroke="none" fill="currentColor"><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></svg>
);
export const Codex = (p: IconProps) => <svg {...base} {...p} strokeWidth={1.3}><rect x="2" y="3" width="12" height="10" rx="2" /><path d="m5 6.5 2 1.5-2 1.5M8.5 10h2.5" /></svg>;
export const PullRequest = (p: IconProps) => (
  <svg {...base} {...p} strokeWidth={1.3}><circle cx="4" cy="3.5" r="1.5" /><circle cx="4" cy="12.5" r="1.5" /><circle cx="12" cy="12.5" r="1.5" /><path d="M4 5v6M12 11V6.5c0-1-.7-1.5-1.5-1.5H8m0 0 1.6-1.6M8 5l1.6 1.6" /></svg>
);
export const LogOut = (p: IconProps) => <svg {...base} {...p}><path d="M6.5 13.5H3.5c-.6 0-1-.4-1-1v-9c0-.6.4-1 1-1h3M10.5 11 13.5 8l-3-3M13.5 8H6" /></svg>;
export const Swap = (p: IconProps) => <svg {...base} {...p}><path d="M3 5.5h10M10 2.5l3 3-3 3M13 10.5H3M6 7.5l-3 3 3 3" /></svg>;

export const GitHub = (p: IconProps) => (
  <svg width={15} height={15} viewBox="0 0 16 16" aria-hidden="true" {...p}>
    <path
      fill="currentColor"
      d="M8 1.5a6.5 6.5 0 0 0-2 12.7c.3 0 .4-.1.4-.3v-1.2c-1.8.4-2.2-.8-2.2-.8-.3-.7-.7-.9-.7-.9-.6-.4 0-.4 0-.4.6 0 1 .7 1 .7.6 1 1.5.7 1.9.5 0-.4.2-.7.4-.9-1.4-.2-3-.7-3-3.2 0-.7.3-1.3.7-1.7-.1-.2-.3-.8 0-1.7 0 0 .6-.2 1.8.7a6 6 0 0 1 3.2 0c1.2-.9 1.8-.7 1.8-.7.3.9.1 1.5 0 1.7.4.4.7 1 .7 1.7 0 2.5-1.5 3-3 3.2.3.2.5.6.5 1.2v1.8c0 .2.1.3.4.3A6.5 6.5 0 0 0 8 1.5Z"
    />
  </svg>
);

export const Google = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
    <path d="M15 8.2c0-.5 0-1-.1-1.4H8.1v2.7h3.9c-.2.9-.7 1.6-1.4 2.1v1.8h2.3c1.3-1.2 2.1-3 2.1-5.2Z" fill="#4285F4" />
    <path d="M8.1 15.2c1.9 0 3.6-.6 4.7-1.7l-2.3-1.8c-.6.4-1.4.7-2.4.7-1.8 0-3.4-1.2-3.9-2.9H1.8v1.9a7.1 7.1 0 0 0 6.3 3.8Z" fill="#34A853" />
    <path d="M4.2 9.5a4.3 4.3 0 0 1 0-2.8V4.8H1.8a7.1 7.1 0 0 0 0 6.6l2.4-1.9Z" fill="#FBBC05" />
    <path d="M8.1 3.6c1 0 2 .4 2.7 1.1l2-2A6.9 6.9 0 0 0 8.1.8 7.1 7.1 0 0 0 1.8 4.8l2.4 1.9c.5-1.8 2.1-3.1 3.9-3.1Z" fill="#EA4335" />
  </svg>
);

export const Phone = () => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10.5 18.5h3" />
  </svg>
);

export const Web = () => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
    <rect x="2.5" y="4" width="19" height="15" rx="2.5" /><path d="M2.5 8.5h19" />
    <circle cx="5.5" cy="6.3" r=".8" fill="currentColor" stroke="none" /><circle cx="8" cy="6.3" r=".8" fill="currentColor" stroke="none" />
  </svg>
);

export const Cursor = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4 3l11 6-5 1.5L8 16 4 3Z" className="cursor-fill" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);
