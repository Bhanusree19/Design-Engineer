import React from 'react';
import type { RepoContext } from '../../api/client';

type Props = {
  context: RepoContext;
  source?: 'detected' | 'user' | null;
  /** Agent step: one-line summary with a link back to the stack step. */
  compact?: boolean;
  onChangeStack?: () => void;
};

const TITLES: Record<RepoContext['status'], string> = {
  'existing-app': 'Found an existing app',
  'multiple-apps': 'Found more than one app',
  empty: 'This branch has no app yet',
  'no-app': 'No React app on this branch yet',
  unsupported: 'This branch uses another framework',
  'branch-not-found': 'Branch not found',
  'repo-not-found': 'Repository not reachable',
};

function Chips({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <span className="repo-chips">{items.map((item) => <span key={item} className="repo-chip">{item}</span>)}</span>;
}

export default function RepoContextCard({ context, source, compact, onChangeStack }: Props) {
  const app = context.app;
  const stackName = context.stack === 'react-js' ? 'React JS' : context.stack === 'react-native' ? 'React Native' : null;

  if (compact) {
    if (!app || source !== 'detected') return null;
    return (
      <div className="repo-card repo-card-compact" role="status">
        <span className="repo-dot ok" aria-hidden="true" />
        <span className="repo-card-text">
          <b>{stackName} detected</b> in {context.repository || 'this repository'}: {context.summary}.
        </span>
        {onChangeStack && <button type="button" className="link small" onClick={onChangeStack}>Change</button>}
      </div>
    );
  }

  return (
    <section className={`repo-card ${app ? 'found' : 'missing'}`} aria-label="Repository context">
      <div className="repo-card-head">
        <span className={`repo-dot ${app ? 'ok' : 'info'}`} aria-hidden="true" />
        <b>{TITLES[context.status]}</b>
        {context.branch && <span className="repo-branch">{context.branch}</span>}
      </div>
      <p className="repo-card-summary">{context.summary}</p>
      {app && (
        <dl className="repo-facts">
          <div><dt>Framework</dt><dd>{app.frameworkName}{app.versions.expo ? ` SDK ${app.versions.expo}` : ''}{app.versions.reactNative ? `, RN ${app.versions.reactNative}` : ''}</dd></div>
          <div><dt>Language</dt><dd>{app.language === 'typescript' ? 'TypeScript' : 'JavaScript'}{app.packageManager ? `, ${app.packageManager}` : ''}</dd></div>
          {!!app.styling.length && <div><dt>Styling</dt><dd><Chips items={app.styling} /></dd></div>}
          {!!app.uiLibraries.length && <div><dt>UI library</dt><dd><Chips items={app.uiLibraries} /></dd></div>}
          {!!app.navigation.length && <div><dt>Navigation</dt><dd><Chips items={app.navigation} /></dd></div>}
          {app.components.count > 0 && (
            <div><dt>Components</dt><dd>
              {app.components.count} found in {app.components.dirs.join(', ')}
              <span className="repo-names">{app.components.names.slice(0, 8).join(', ')}{app.components.count > 8 ? ` and ${app.components.count - 8} more` : ''}</span>
            </dd></div>
          )}
        </dl>
      )}
      {app && <p className="repo-card-foot">The coding agent reuses these components and follows the same styling and folder structure.</p>}
    </section>
  );
}
