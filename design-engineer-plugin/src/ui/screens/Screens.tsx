// Step 5: pick frames from the canvas selection, fetch them, see what was saved.

import React from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, Route, Spinner } from '../components/Chrome';
import { Check, Cursor, File } from '../components/Icons';
import type { DesignEngineerActions, DesignEngineerState, SelectionItem } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function ScreensHeader({ state, actions }: Props) {
  return (
    <Header state={state} actions={actions}>
      {state.selectedRepo && state.selectedBranch && (
        <Route repo={state.selectedRepo} branch={state.selectedBranch} />
      )}
    </Header>
  );
}

function Thumb({ item }: { item: SelectionItem }) {
  const wide = item.width > item.height;
  return (
    <span className={`thumb ${wide ? 'wide' : ''}`} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

function Size({ item }: { item: SelectionItem }) {
  return <span>{Math.round(item.width)} × {Math.round(item.height)} {item.type.toLowerCase()}</span>;
}

// -----------------------------------------------------------------------------
// SELECT
// -----------------------------------------------------------------------------

export function ScreensStep({ state, actions }: Props) {
  const busy = state.waiting === 'extracting' || state.waiting === 'saving';
  if (busy) return <Fetching state={state} actions={actions} />;

  const total = state.selection.length;
  const checked = state.checkedIds.size;

  return (
    <>
      <ScreensHeader state={state} actions={actions} />
      <Rail step="screens" />
      <Body>
        <h1>{total === 0 ? 'Select screens' : `${checked} of ${plural(total, 'screen')} selected`}</h1>
        {state.error && <ErrorBanner message={state.error} />}

        {total === 0 ? (
          <div className="empty">
            <div>
              <div className="canvas-hint" aria-hidden="true">
                <div className="fr" />
                <Cursor />
              </div>
              <p>Click a frame on the canvas, or Shift-click to select several. They'll appear here.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="listhead">
              <span>From your canvas selection</span>
              {checked === total ? (
                <button className="link small" type="button" onClick={actions.clearChecked}>Clear</button>
              ) : (
                <button className="link small" type="button" onClick={actions.checkAll}>Select all</button>
              )}
            </div>
            <div className="stack scroll">
              {state.selection.map((item) => {
                const on = state.checkedIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={`scr ${on ? 'on' : ''}`}
                    onClick={() => actions.toggleChecked(item.id)}
                  >
                    <span className="cb">{on && <Check />}</span>
                    <Thumb item={item} />
                    <span className="tx"><b>{item.name}</b><Size item={item} /></span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Body>
      <Footer>
        <button className="btn btn-ghost" type="button" onClick={actions.goBack}>Back to branch</button>
        <button className="btn btn-primary" type="button" disabled={checked === 0} onClick={actions.fetchScreens}>
          {checked === 0 ? 'Select screens to fetch' : `Fetch ${plural(checked, 'screen')}`}
        </button>
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// FETCHING
// -----------------------------------------------------------------------------

function Fetching({ state, actions }: Props) {
  const saving = state.waiting === 'saving';
  const items = state.selection.filter((s) => state.checkedIds.has(s.id));
  const count = state.extractingCount || items.length;

  return (
    <>
      <ScreensHeader state={state} actions={actions} />
      <Rail step="screens" />
      <Body>
        <h1>{saving ? 'Saving Design Context' : `Fetching ${plural(count, 'screen')}`}</h1>
        <div className={`bar ${saving ? 'late' : ''}`} role="progressbar" aria-label="Fetching screens"><i /></div>
        <div className="stack scroll">
          {items.map((item) => (
            <div className="scr" key={item.id}>
              <Thumb item={item} />
              <span className="tx"><b>{item.name}</b><Size item={item} /></span>
              <span className="st"><Spinner />{saving ? 'Saving' : 'Reading layers'}</span>
            </div>
          ))}
        </div>
        <div className="hint">Keep this plugin open until saving finishes.</div>
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" disabled>{saving ? 'Saving…' : 'Fetching…'}</button>
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// DONE
// -----------------------------------------------------------------------------

export function Done({ state, actions }: Props) {
  const files = state.savedFiles;

  return (
    <>
      <ScreensHeader state={state} actions={actions} />
      <Rail step="done" />
      <Body>
        <span className="big-ok" aria-hidden="true"><Check /></span>
        <h1>{files.length > 0 ? `Design Context saved for ${plural(files.length, 'screen')}` : 'Design Context saved'}</h1>
        {state.error && <ErrorBanner message={state.error} />}
        <p className="lede">
          Saved on the Design Engineer server for <span className="mono">{state.selectedBranch}</span>.
        </p>
        {files.length > 0 && (
          <div className="files scroll">
            {files.map((file) => (
              <div key={file}>
                <File className="ico" />
                <span title={file}>{file.split('/').pop()}</span>
              </div>
            ))}
          </div>
        )}
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" onClick={() => void actions.planImplementation()}>
          Plan implementation
        </button>
        <button className="btn btn-primary" type="button" onClick={actions.fetchMore}>Fetch more screens</button>
        <div className="btn-row">
          <button className="btn btn-ghost" type="button" onClick={actions.goBack}>Back to screens</button>
          <button className="btn btn-ghost" type="button" onClick={actions.changeBranch}>Change branch</button>
          <button className="btn btn-ghost" type="button" onClick={actions.changeRepo}>Change repo</button>
        </div>
      </Footer>
    </>
  );
}

export function Planning({ state, actions }: Props) {
  return (
    <>
      <ScreensHeader state={state} actions={actions} />
      <Rail step="done" />
      <Body>
        {state.waiting === 'planning' ? (
          <>
            <h1>Building your implementation plan</h1>
            <p className="lede">Review comes first. Codex will not write code or open a PR until you approve.</p>
            <div className="wait"><Spinner /><span className="wait-label">Analyzing {plural(state.implementationScreens.length, 'screen')}</span></div>
            <div className="bar" role="progressbar" aria-label="Generating implementation plan"><i /></div>
          </>
        ) : (
          <>
            <h1>Could not generate the plan</h1>
            {state.error && <ErrorBanner message={state.error} />}
            <p className="lede">Your Design Context is saved. Retry planning or fetch additional screens.</p>
          </>
        )}
      </Body>
      <Footer>
        {state.waiting === 'planning' ? (
          <button className="btn btn-primary" type="button" disabled>Planning…</button>
        ) : (
          <>
            <button className="btn btn-primary" type="button" onClick={() => void actions.planImplementation()}>Try planning again</button>
            <button className="btn btn-ghost" type="button" onClick={actions.fetchMore}>Fetch more screens</button>
          </>
        )}
      </Footer>
    </>
  );
}

export function PlanReview({ state, actions }: Props) {
  const plan = state.screenPlan;

  return (
    <>
      <ScreensHeader state={state} actions={actions} />
      <Rail step="done" />
      <Body>
        <h1>Review implementation plan</h1>
        {state.error && <ErrorBanner message={state.error} />}
        {plan ? (
          <>
            <div className="plan-meta">
              <span><b>Repository</b>{plan.repository}</span>
              <span><b>Target branch</b>{plan.proposedBranch}</span>
              <span><b>Stack</b>{plan.stack === 'react-js' ? 'React' : 'React Native'}</span>
            </div>
            <p className="lede">{plural(plan.screens.length, 'screen')} included. Nothing is changed until you approve below.</p>
            <div className="plan-copy scroll">{plan.plan}</div>
            <details className="plan-prompt">
              <summary>View the exact Codex prompt</summary>
              <pre className="plan-copy scroll">{plan.prompt}</pre>
            </details>
          </>
        ) : (
          <ErrorBanner message="The implementation plan is unavailable. Generate it again to continue." />
        )}
      </Body>
      <Footer>
        <button
          className="btn btn-primary"
          type="button"
          onClick={actions.startImplementation}
          disabled={!plan}
        >
          Start implement
        </button>
        <div className="btn-row">
          <button className="btn btn-ghost" type="button" onClick={actions.fetchMore}>Fetch more screens</button>
          <button className="btn btn-ghost" type="button" onClick={() => void actions.planImplementation()}>Regenerate plan</button>
        </div>
      </Footer>
    </>
  );
}

export function Implementing({ state, actions }: Props) {
  return (
    <>
      <ScreensHeader state={state} actions={actions} />
      <Rail step="done" />
      <Body>
        <h1>Codex is implementing your screens</h1>
        <p className="lede">Codex is working on a branch, then it will commit, push, and open your pull request.</p>
        {state.error && <ErrorBanner message={state.error} />}
        <div className="bar" role="progressbar" aria-label="Codex implementation in progress"><i /></div>
        <div className="wait"><Spinner /><span className="wait-label">Running Codex and creating pull request</span></div>
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" disabled>Implementing…</button>
      </Footer>
    </>
  );
}

export function Complete({ state, actions }: Props) {
  const result = state.implementation;

  return (
    <>
      <ScreensHeader state={state} actions={actions} />
      <Rail step="done" />
      <Body>
        <span className="big-ok" aria-hidden="true"><Check /></span>
        <h1>Implementation complete</h1>
        <p className="lede">
          Codex implemented {plural(result?.screens.length || 0, 'screen')} on branch{' '}
          <span className="mono">{result?.branch}</span>.
        </p>
        {result?.pullRequestUrl && (
          <a className="btn btn-primary pr-link" href={result.pullRequestUrl} target="_blank" rel="noreferrer">
            Open pull request
          </a>
        )}
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" onClick={actions.fetchMore}>Fetch more screens</button>
        <button className="btn btn-ghost" type="button" onClick={actions.goBack}>Review the plan</button>
      </Footer>
    </>
  );
}
