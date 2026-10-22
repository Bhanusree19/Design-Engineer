// Shared frame pieces: headers, project rail, body, footer, banners, waits, sheet.

import React from 'react';
import { Alert, Back, Check, Mail, Mark } from './Icons';
import type { Step } from '../hooks/useDesignEngineer';

// -----------------------------------------------------------------------------
// HEADERS
// -----------------------------------------------------------------------------

// Top level: logo, name and the account avatar.
export function AppHeader({ email, onAvatar, avatarOpen }: { email?: string; onAvatar?: () => void; avatarOpen?: boolean }) {
  const initial = (email || '?').trim().charAt(0).toUpperCase();
  return (
    <header className="head">
      <Mark />
      <span className="head-name">Design Engineer</span>
      {onAvatar && (
        <button
          type="button"
          className={`avatar ${avatarOpen ? 'on' : ''}`}
          onClick={onAvatar}
          aria-label="Account and connections"
          aria-expanded={avatarOpen}
          title={email}
        >
          {initial}
        </button>
      )}
    </header>
  );
}

// Account screens: a back link only.
export function BackHeader({ label = 'Back', onBack }: { label?: string; onBack: () => void }) {
  return (
    <header className="head">
      <button type="button" className="back" onClick={onBack}>
        <Back />
        {label}
      </button>
    </header>
  );
}

// Inside a project: back to Projects, project name, repo@branch chip.
export function ProjectHeader({
  name,
  repo,
  branch,
  onBack,
  onRoute,
}: {
  name: string;
  repo?: string | null;
  branch?: string | null;
  onBack: () => void;
  onRoute?: () => void;
}) {
  const repoName = repo ? repo.split('/').pop() : null;
  return (
    <header className="head">
      <button type="button" className="back icon-only" onClick={onBack} aria-label="All projects" title="All projects">
        <Back />
      </button>
      <span className="proj">{name}</span>
      {repoName && branch && (
        <button type="button" className="route" onClick={onRoute} title={`${repo} @ ${branch}. Change setup`}>
          <b>{repoName}</b>@{branch}
        </button>
      )}
    </header>
  );
}

// -----------------------------------------------------------------------------
// PROJECT RAIL
// -----------------------------------------------------------------------------

const RAIL = ['Repo', 'Branch', 'Stack', 'Screens', 'Build'];

const RAIL_INDEX: Partial<Record<Step, number>> = {
  repo: 0,
  github: 0,
  branch: 1,
  stack: 2,
  screens: 3,
  done: 4,
  plan: 4,
  implementing: 4,
  implemented: 5,
};

export function Rail({ step }: { step: Step }) {
  const current = RAIL_INDEX[step] ?? 0;
  return (
    <ol className="rail" aria-label="Project setup">
      {RAIL.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'now' : '';
        return (
          <li key={label} className={state} aria-current={state === 'now' ? 'step' : undefined}>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

// -----------------------------------------------------------------------------
// LAYOUT
// -----------------------------------------------------------------------------

export function Body({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <main className={`body ${className}`}>{children}</main>;
}

export function Footer({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <footer className="foot">
      {children}
      {hint && <div className="hint">{hint}</div>}
    </footer>
  );
}

// -----------------------------------------------------------------------------
// FEEDBACK
// -----------------------------------------------------------------------------

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="banner bad" role="alert">
      <Alert className="ico" />
      <p>{message}</p>
    </div>
  );
}

export function WarnBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="banner warn" role="alert">
      <Alert className="ico" />
      <p>{children}</p>
    </div>
  );
}

export function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="banner info" role="status">
      <Mail className="ico" />
      <p>{children}</p>
    </div>
  );
}

export function SuccessBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="banner ok">
      <Check className="ico" />
      <p>{children}</p>
    </div>
  );
}

export function Spinner() {
  return <span className="spin" aria-hidden="true" />;
}

export function WaitRow({ label, detail }: { label: string; detail?: React.ReactNode }) {
  return (
    <div className="wait" role="status">
      <Spinner />
      <span className="wait-label">{label}</span>
      {detail && <span className="wait-detail">{detail}</span>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// SHEET
// -----------------------------------------------------------------------------

export function Sheet({ onClose, children, label }: { onClose: () => void; children: React.ReactNode; label: string }) {
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="sheet"
        role="dialog"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="grab" aria-hidden="true" />
        {children}
      </div>
    </>
  );
}
