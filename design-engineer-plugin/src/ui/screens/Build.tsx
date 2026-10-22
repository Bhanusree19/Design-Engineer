// Implementation plan, implementing, and the pull request result.

import React, { useEffect, useState } from 'react';
import { Body, ErrorBanner, Footer, Rail, Spinner, WaitRow } from '../components/Chrome';
import { Branch, Check, External, PullRequest, Refresh } from '../components/Icons';
import CodexSheet from './CodexSheet';
import { SetupHeader } from './Setup';
import { stackLabel } from '../hooks/useDesignEngineer';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// -----------------------------------------------------------------------------
// PLAN
// -----------------------------------------------------------------------------

export function Plan({ state, actions }: Props) {
  const plan = state.plan;
  const planning = state.waiting === 'planning';
  const codexOpen = state.waiting === 'codex' || !!state.codexDevice;

  return (
    <>
      <SetupHeader state={state} actions={actions} />
      <Rail step="plan" />
      <Body>
        <h1>Implementation plan</h1>
        {state.error && <ErrorBanner message={state.error} />}
        {planning && <WaitRow label={`Planning ${plural(state.fetchedScreens.length, 'screen')}`} detail="Writes no code" />}
        {plan && !planning && (
          <div className="scroll plan">
            <dl className="facts">
              <dt>Repository</dt><dd title={plan.repository}>{plan.repository}</dd>
              <dt>From branch</dt><dd>{plan.baseBranch}</dd>
              <dt>New branch</dt><dd title={plan.proposedBranch}>{plan.proposedBranch}</dd>
              <dt>Stack</dt><dd>{stackLabel(plan.stack)}</dd>
              <dt>Screens</dt><dd title={plan.screens.map((s) => s.name).join(', ')}>{plan.screens.map((s) => s.name).join(', ')}</dd>
            </dl>
            <ol className="steps">
              <li><span><b>Read the repo</b> to learn its stack, package manager and conventions.</span></li>
              <li><span><b>Build the {plural(plan.screens.length, 'screen')}</b> from their Design Context: layout, type, colors, spacing.</span></li>
              <li><span><b>Wire navigation</b> between the screens, with shared components and theme tokens.</span></li>
              <li><span><b>Run tests and lint</b>, then open a pull request with test steps.</span></li>
            </ol>
            <details className="disclose">
              <summary>Full plan <span>Markdown</span></summary>
              <pre>{plan.plan}</pre>
            </details>
            <details className="disclose">
              <summary>Codex prompt <span>Exact text sent</span></summary>
              <pre>{plan.prompt}</pre>
            </details>
          </div>
        )}
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" onClick={actions.implement} disabled={!plan || planning}>
          Start implementation
        </button>
        <button className="btn btn-ghost" type="button" onClick={actions.makePlan} disabled={planning}>
          <Refresh />
          Regenerate plan
        </button>
      </Footer>
      {codexOpen && <CodexSheet state={state} actions={actions} title="Connect Codex to implement" />}
    </>
  );
}

// -----------------------------------------------------------------------------
// IMPLEMENTING
// -----------------------------------------------------------------------------

function useElapsed(since: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [since]);
  if (!since) return '0:00';
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Implementing({ state, actions }: Props) {
  const elapsed = useElapsed(state.waiting === 'implementing' ? state.implementStartedAt : null);
  const count = state.plan?.screens.length || state.fetchedScreens.length;
  const branch = state.plan?.proposedBranch;

  if (state.error && state.waiting !== 'implementing') {
    return (
      <>
        <SetupHeader state={state} actions={actions} />
        <Rail step="implementing" />
        <Body>
          <h1>Codex couldn't finish</h1>
          <ErrorBanner message={`No pull request was opened. ${state.error}`} />
          <p className="lede flat">Your screens and plan are kept. Try again, or regenerate the plan first.</p>
        </Body>
        <Footer>
          <button className="btn btn-primary" type="button" onClick={actions.implement}>
            <Refresh />
            Try again
          </button>
          <button className="btn btn-ghost" type="button" onClick={actions.backToPlan}>Back to plan</button>
        </Footer>
      </>
    );
  }

  return (
    <>
      <SetupHeader state={state} actions={actions} />
      <Rail step="implementing" />
      <Body>
        <h1>Codex is building {plural(count, 'screen')}</h1>
        <p className="lede">This usually takes several minutes. You can keep working in Figma, but leave the plugin open.</p>
        <div className="timeline">
          <div><Check className="ico" /><span>Plan approved</span><time /></div>
          <div className="cur">
            <Spinner />
            <span>Writing code{branch ? <> on <span className="mono">{branch}</span></> : null}</span>
            <time>{elapsed}</time>
          </div>
          <div className="todo"><span className="dotc" /><span>Open pull request</span><time /></div>
        </div>
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" disabled>Building…</button>
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// PULL REQUEST READY
// -----------------------------------------------------------------------------

export function Implemented({ state, actions }: Props) {
  const results = state.implementations;
  const base = state.plan?.baseBranch || state.selectedBranch;
  const repo = state.plan?.repository || state.selectedRepo;

  return (
    <>
      <SetupHeader state={state} actions={actions} />
      <Rail step="implemented" />
      <Body>
        <span className="big-ok" aria-hidden="true"><Check /></span>
        <h1>{results.length > 1 ? `${results.length} pull requests ready to review` : 'Pull request ready to review'}</h1>
        <p className="lede">Test steps are in the pull request description.</p>
        <div className="stack scroll">
          {results.map((r) => (
            <div className="pr" key={r.pullRequestUrl || r.branch}>
              <div className="top">
                <PullRequest className="ico ok" />
                <b>{r.screens.join(', ')}</b>
                <span className="pill-ok">Open</span>
              </div>
              <div className="br">
                <Branch className="ico" />
                <span title={r.branch}>{r.branch}{base ? ` → ${base}` : ''}</span>
              </div>
              <div className="br"><span>{plural(r.screens.length, 'screen')}{repo ? ` · ${repo}` : ''}</span></div>
              {results.length > 1 && r.pullRequestUrl && (
                <button className="link small" type="button" onClick={() => window.open(r.pullRequestUrl, '_blank')}>Open pull request</button>
              )}
            </div>
          ))}
        </div>
      </Body>
      <Footer>
        {results.length === 1 && results[0].pullRequestUrl && (
          <button className="btn btn-primary" type="button" onClick={() => window.open(results[0].pullRequestUrl, '_blank')}>
            <External />
            Open pull request
          </button>
        )}
        <button className={`btn ${results.length === 1 ? 'btn-ghost' : 'btn-primary'}`} type="button" onClick={actions.buildMore}>
          Build more screens
        </button>
      </Footer>
    </>
  );
}
