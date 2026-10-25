// Shared frame pieces: header, step rail, banners, waiting row, footer.

import React from 'react';
import { Alert, Check, Mark } from './Icons';
import type { DesignEngineerActions, DesignEngineerState, Step } from '../hooks/useDesignEngineer';

// -----------------------------------------------------------------------------
// HEADER
// -----------------------------------------------------------------------------

export function Header({
  children,
  state,
  actions,
}: {
  children?: React.ReactNode;
  state?: DesignEngineerState;
  actions?: DesignEngineerActions;
}) {
  return (
    <header className="head">
      <Mark />
      <span className="head-name">Design Engineer</span>
      {children}
      {state?.accountSignedIn && actions && (
        <details className="account-menu">
          <summary aria-label="Account options" title="Account options">Account</summary>
          <div className="account-menu-panel">
            <button type="button" onClick={actions.logoutAccount}>Log out</button>
          </div>
        </details>
      )}
    </header>
  );
}

export function Who({ name }: { name: string }) {
  return (
    <span className="who" title={`Signed in as ${name}`}>
      <span className="dot" />
      {name}
    </span>
  );
}

export function Route({ repo, branch }: { repo: string; branch: string }) {
  const repoName = repo.split('/').pop() || repo;
  return (
    <span className="route" title={`${repo} @ ${branch}`}>
      <b>{repoName}</b>@{branch}
    </span>
  );
}

// -----------------------------------------------------------------------------
// STEP RAIL
// -----------------------------------------------------------------------------

const RAIL: { key: Step; label: string }[] = [
  { key: 'account', label: 'Account' },
  { key: 'signin', label: 'Codex' },
  { key: 'github', label: 'GitHub' },
  { key: 'project', label: 'Project' },
  { key: 'repo', label: 'Repo' },
  { key: 'branch', label: 'Branch' },
  { key: 'screens', label: 'Screens' },
  { key: 'stack', label: 'Stack' },
];

export function Rail({ step }: { step: Step }) {
  const current = step === 'done' ? RAIL.length : RAIL.findIndex((r) => r.key === step);
  return (
    <ol className="rail" aria-label="Setup progress">
      {RAIL.map((r, i) => {
        const state = i < current ? 'done' : i === current ? 'now' : '';
        return (
          <li key={r.key} className={state} aria-current={state === 'now' ? 'step' : undefined}>
            {r.label}
          </li>
        );
      })}
    </ol>
  );
}

// -----------------------------------------------------------------------------
// BODY / FOOTER
// -----------------------------------------------------------------------------

export function Body({ children }: { children: React.ReactNode }) {
  return <main className="body">{children}</main>;
}

export function Footer({ children, hint }: { children: React.ReactNode; hint?: string }) {
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

export function WaitRow({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="wait" role="status">
      <Spinner />
      <span className="wait-label">{label}</span>
      {detail && <span className="wait-detail">{detail}</span>}
    </div>
  );
}
