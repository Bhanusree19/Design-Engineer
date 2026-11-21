// Shared frame pieces: headers, body, footer, banners, waiting row, sync icon, sheet.

import React from 'react';
import { Alert, Back, Check, LinkOff, Mark, More, SyncOk, Warn } from './Icons';

/** Home header: mark, name, avatar that opens the account sheet. */
export function AppHeader({ initial, onAvatar, active }: { initial: string; onAvatar: () => void; active?: boolean }) {
  return (
    <header className="head">
      <Mark />
      <span className="head-name">Design Engineer</span>
      <button type="button" className={`avatar ${active ? 'on' : ''}`} aria-label="Account" onClick={onAvatar}>
        {initial}
      </button>
    </header>
  );
}

/** Inner-screen header: Back, the screen or project title, optional menu. */
export function BackHeader({
  title,
  onBack,
  label = 'Back',
  showLabel,
  onMore,
  children,
}: {
  title?: string;
  onBack: () => void;
  label?: string;
  showLabel?: boolean;
  onMore?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="head">
      <button type="button" className={`back ${showLabel ? '' : 'icon-only'}`} aria-label={label} onClick={onBack}>
        <Back />
        {showLabel && label}
      </button>
      {title && <span className="proj">{title}</span>}
      {children}
      {onMore && (
        <button type="button" className="kebab push-right" aria-label="Project menu" onClick={onMore}>
          <More className="ico" />
        </button>
      )}
    </header>
  );
}

export function Body({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <main className={`body ${className}`}>{children}</main>;
}

export function Footer({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <footer className="foot">
      {children}
      {hint && <div className="hint">{hint}</div>}
    </footer>
  );
}

export function Section({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="p-sec">
      <span>{title}</span>
      {action}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="banner bad" role="alert">
      <Alert className="ico" />
      <p>{message}</p>
      {onDismiss && (
        <button type="button" className="banner-x" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}

export function InfoBanner({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'ok' | 'warn' }) {
  const Icon = tone === 'ok' ? Check : tone === 'warn' ? Warn : Alert;
  return (
    <div className={`banner ${tone}`} role="status">
      <Icon className="ico" />
      <p>{children}</p>
    </div>
  );
}

/** Error + notice banners for the current screen. */
export function Messages({ error, notice, onDismiss }: { error: string | null; notice: string | null; onDismiss?: () => void }) {
  return (
    <>
      {error && <ErrorBanner message={error} onDismiss={onDismiss} />}
      {notice && <InfoBanner>{notice}</InfoBanner>}
    </>
  );
}

export function Spinner() {
  return <span className="spin" aria-hidden="true" />;
}

export function WaitRow({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="wait" role="status">
      <Spinner />
      <span className="t">{label}</span>
      {detail && <span className="s">{detail}</span>}
    </div>
  );
}

export type SyncKind = 'ok' | 'off' | 'warn' | 'run' | 'unknown';
const SYNC_TITLES: Record<SyncKind, string> = {
  ok: 'Synced',
  off: 'Not linked',
  warn: 'Needs attention',
  run: 'Checking',
  unknown: 'Not checked yet',
};

/** The per-repo sync icon: synced, not linked, needs attention, checking. */
export function SyncIcon({ kind, title }: { kind: SyncKind; title?: string }) {
  const label = title || SYNC_TITLES[kind];
  return (
    <span className={`sync ${kind}`} title={label} role="img" aria-label={label}>
      {kind === 'ok' && <SyncOk />}
      {kind === 'off' && <LinkOff />}
      {kind === 'warn' && <Warn />}
      {(kind === 'run' || kind === 'unknown') && <span className="sync-dot" />}
    </span>
  );
}

/** Bottom sheet over the current screen. Tapping the scrim closes it. */
export function Sheet({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-label={label}>
        <div className="grab" />
        {children}
      </div>
    </>
  );
}
