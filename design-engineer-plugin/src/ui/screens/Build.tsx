// Flow F: select frames → plan (build-into, AI model, checklist) → running → result.

import React, { useState } from 'react';
import * as api from '../../api/client';
import { BackHeader, Body, Footer, Messages, Sheet, Spinner, SyncIcon, WaitRow } from '../components/Chrome';
import { Alert, Branch, Check, ChevronDown, Clock, Cursor, External, Model, PullRequest, Refresh, XCircle } from '../components/Icons';
import { linkProblem, linkSyncKind } from './Project';
import {
  agentDetail,
  agentLabel,
  clock,
  readableSeconds,
  repoName,
  stackLabel,
  type DesignEngineerActions,
  type DesignEngineerState,
  type SelectionItem,
} from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function Thumb({ item }: { item: SelectionItem }) {
  return (
    <span className={`thumb ${item.width > item.height ? 'wide' : ''}`} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

export function SelectScreens({ state, actions }: Props) {
  const total = state.selection.length;
  const checked = state.selection.filter(item => state.checkedIds.has(item.id)).length;
  const fetching = state.busy === 'extracting' || state.busy === 'saving';
  return (
    <>
      <BackHeader title={state.project?.name} onBack={actions.back} />
      <Body>
        <h3>{total === 0 ? 'Select screens on the canvas' : `${checked} of ${plural(total, 'screen')} selected`}</h3>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        {!fetching && <>
          <p className="lede small">Select multiple frames on the canvas with Shift-click, or browse page screens and tick the ones you want.</p>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={actions.useCanvasSelection}>{state.selectionSource === 'canvas' ? 'Refresh canvas' : 'Use canvas selection'}</button>
            <button type="button" className="btn btn-ghost" onClick={actions.browsePageScreens}>Browse page screens</button>
          </div>
        </>}
        {fetching ? (
          <WaitRow label={state.busy === 'saving' ? 'Saving the screens' : `Reading ${plural(state.extractingCount || checked, 'screen')} from Figma`} />
        ) : total === 0 ? (
          <div className="empty">
            <div>
              <div className="canvas-hint" aria-hidden="true"><div className="fr" /><Cursor /></div>
              <p>Click a frame on the canvas, or Shift-click to select several. They'll appear here.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="listhead">
              <span>{state.selectionSource === 'page' ? 'Screens on this page' : 'From your canvas selection'}</span>
              {checked === total ? (
                <button type="button" className="link small" onClick={actions.clearChecked}>Clear</button>
              ) : (
                <button type="button" className="link small" onClick={actions.checkAll}>Select all</button>
              )}
            </div>
            <div className="stack scroll">
              {state.selection.map((item) => {
                const on = state.checkedIds.has(item.id);
                return (
                  <button key={item.id} type="button" role="checkbox" aria-checked={on} className={`scr ${on ? 'on' : ''}`} onClick={() => actions.toggleChecked(item.id)}>
                    <span className="cb">{on && <Check />}</span>
                    <Thumb item={item} />
                    <span className="tx"><b>{item.name}</b><span>{Math.round(item.width)} × {Math.round(item.height)} {item.type.toLowerCase()}</span></span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Body>
      <Footer>
        <button type="button" className="btn btn-primary" disabled={fetching || checked === 0} onClick={actions.fetchScreens}>
          {fetching ? 'Fetching…' : checked ? `Fetch ${plural(checked, 'screen')}` : 'Select a screen'}
        </button>
      </Footer>
    </>
  );
}

interface CheckItem {
  ok: boolean;
  text: string;
  fix?: { label: string; run: () => void };
}

export function Plan({ state, actions }: Props) {
  const [expanded, setExpanded] = useState(false);
  const target = actions.targetLink();
  const m = state.accountModel;
  const ls = target ? state.linkStates[target.id] : undefined;
  const items: CheckItem[] = [];

  if (!target) {
    items.push({ ok: false, text: 'No repo linked', fix: { label: 'Link a repo', run: () => actions.startLink('new') } });
  } else {
    const problem = linkProblem(ls, target);
    if (problem) {
      items.push({
        ok: false,
        text: problem,
        fix: ls === 'repo-not-found'
          ? { label: 'Choose repo', run: () => actions.startLink('new') }
          : ls === 'github'
            ? { label: 'Reconnect', run: () => actions.startLink('branch', target.id) }
            : { label: 'Choose branch', run: () => actions.startLink('branch', target.id) },
      });
    } else if (!state.project?.stack && !target.stack) {
      items.push({ ok: false, text: 'Stack not chosen', fix: { label: 'Choose', run: () => void actions.openStackFor(target.id) } });
    } else {
      const stack = stackLabel(state.project?.stack || target.stack);
      items.push({ ok: true, text: ls === 'ok' ? `Repo synced${stack ? `, ${stack}` : ''}` : `Repo linked${stack ? `, ${stack}` : ''}` });
    }
  }

  if (!m) {
    items.push({ ok: false, text: 'No AI model chosen', fix: { label: 'Choose', run: actions.openModel } });
  } else if (!actions.agentConnected(m.agent)) {
    items.push({ ok: false, text: `${agentLabel(m.agent)} not connected`, fix: { label: 'Connect', run: () => actions.changeModelSettings(m.agent) } });
  } else {
    items.push({ ok: true, text: `${agentLabel(m.agent)} connected` });
  }

  const usage = state.billing?.usage;
  if (usage) {
    if (usage.availableSeconds < 60) items.push({ ok: false, text: 'Less than 1 build minute left', fix: { label: 'Upgrade', run: () => void actions.openBilling() } });
    else items.push({ ok: true, text: `${Math.floor(usage.availableSeconds / 60)} build minutes left` });
  }

  const blocking = items.filter((i) => !i.ok).length;
  const plan = state.plan;
  const starting = state.busy === 'starting';
  const count = state.screens.length;
  const multiple = state.links.length > 1;

  return (
    <>
      <BackHeader title={state.project?.name} onBack={actions.back} />
      <Body className="scroll">
        <h3>Plan for {plural(count, 'screen')}</h3>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        {target && (
          <div className="pick">
            <span className="lbl">Build into</span>
            <button type="button" className="sel" disabled={!multiple} onClick={() => actions.setSheet({ kind: 'target' })} aria-label={`Build into ${target.repository} @ ${target.branch}${multiple ? ', change' : ''}`}>
              <SyncIcon kind={linkSyncKind(ls)} />
              <span className="tx">
                <b>{target.repository} @ {target.branch}</b>
                <span>{[target.isDefault ? 'Default' : null, stackLabel(target.stack)].filter(Boolean).join(' · ') || 'Linked repo'}</span>
              </span>
              {multiple && <ChevronDown className="chev-d" />}
            </button>
          </div>
        )}
        {m && (
          <div className="pick">
            <span className="lbl">AI model · your account</span>
            <div className="sel">
              <span className="glyph"><Model /></span>
              <span className="tx"><b>{agentLabel(m.agent)}</b><span>{agentDetail(m)}</span></span>
              <button type="button" className="link small" onClick={actions.openModel}>Switch</button>
            </div>
          </div>
        )}
        <div className="checklist" aria-label="Ready to build">
          {items.map((i) => (
            <div key={i.text} className={`c ${i.ok ? 'okk' : 'bad'}`}>
              {i.ok ? <Check className="ico" /> : <XCircle className="ico" />}
              <span>{i.text}</span>
              {i.fix ? <button type="button" className="link small" onClick={i.fix.run}>{i.fix.label}</button> : <span />}
            </div>
          ))}
        </div>
        {blocking > 0 && <p className="lede flush small">Fix each item and you'll come back here with your screens still selected.</p>}
        {state.planLoading ? (
          <WaitRow label="Writing the plan" />
        ) : plan ? (
          <>
            <div className="disclose"><span className="d-k">New branch</span><span className="mono">{plan.proposedBranch}</span></div>
            <button type="button" className="disclose" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              <span className="d-k">Full plan and prompt</span>
              <span>{expanded ? 'Hide' : 'Expand'}</span>
            </button>
            {expanded && <pre className="plan-text">{plan.plan}</pre>}
          </>
        ) : null}
      </Body>
      <Footer>
        {blocking === 0 && (
          <div className="hold">
            <Clock className="ico" />
            <span>{state.startBufferSeconds ? <>Charged run time + <b>{state.startBufferSeconds} s</b> server start</> : 'Charged by run time'}</span>
          </div>
        )}
        {blocking === 0 && !plan && !state.planLoading ? (
          <button type="button" className="btn btn-primary" onClick={() => void actions.preparePlan()}>Make the plan again</button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={blocking > 0 || !plan || starting || state.planLoading} onClick={() => void actions.startImplementation()}>
            {blocking > 0 ? `Fix ${plural(blocking, 'item')} to start` : starting ? 'Starting…' : 'Start build'}
          </button>
        )}
      </Footer>
      {state.sheet?.kind === 'target' && (
        <Sheet label="Build into" onClose={() => actions.setSheet(null)}>
          <h4 className="sheet-h">Build into</h4>
          <div className="app-list">
            {state.links.map((l) => (
              <button key={l.id} type="button" className={`sel ${target?.id === l.id ? 'on' : ''}`} onClick={() => actions.chooseTarget(l.id)}>
                <SyncIcon kind={linkSyncKind(state.linkStates[l.id])} />
                <span className="tx"><b>{l.repository} @ {l.branch}</b><span>{[l.isDefault ? 'Default' : null, stackLabel(l.stack)].filter(Boolean).join(' · ') || 'Linked repo'}</span></span>
                {target?.id === l.id && <Check className="ico" />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

export function Running({ state, actions }: Props) {
  const job = state.runningJob;
  if (!job) {
    return (
      <>
        <BackHeader title={state.project?.name} onBack={actions.backToProject} />
        <Body><WaitRow label="Checking the build" /></Body>
        <Footer><button type="button" className="btn btn-ghost" onClick={actions.backToProject}>Back to project</button></Footer>
      </>
    );
  }
  const elapsed = clock(state.now - job.startedAt);
  return (
    <>
      <BackHeader title={state.project?.name} onBack={actions.backToProject} />
      <Body>
        <h3>Building {plural(job.screens.length, 'screen')}</h3>
        <p className="lede">You can close the plugin. The build keeps running and you'll see it here when you come back.</p>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        <div className="timeline">
          {job.serverStarted ? (
            <div><Check className="ico" /><span>Server started</span><time /></div>
          ) : (
            <div className="cur"><Spinner /><span>Starting the build server</span><time>{elapsed}</time></div>
          )}
          {job.serverStarted ? (
            <div className="cur"><Spinner /><span>Writing code{job.proposedBranch ? <> on <span className="mono thin">{job.proposedBranch}</span></> : null}</span><time>{elapsed}</time></div>
          ) : (
            <div className="todo"><span className="dotc" /><span>Write code</span><time /></div>
          )}
          <div className="todo"><span className="dotc" /><span>Open pull request</span><time /></div>
        </div>
        <dl className="charge">
          <dt>Into</dt><dd className="mono thin">{job.repository} @ {job.branch}</dd>
          <dt>Model</dt><dd className="thin">{agentLabel(job.agent)}</dd>
        </dl>
      </Body>
      <Footer>
        <button type="button" className="btn btn-ghost" onClick={actions.backToProject}>Back to project</button>
      </Footer>
    </>
  );
}

function Charge({ billed, buffer }: { billed: number | null; buffer: number }) {
  if (billed == null) return null;
  if (!buffer) {
    return <dl className="charge"><dt>Charged</dt><dd>{readableSeconds(billed)}</dd></dl>;
  }
  const extra = Math.min(buffer, billed);
  return (
    <dl className="charge">
      <dt>Run time</dt><dd>{readableSeconds(billed - extra)}</dd>
      <dt>Server start</dt><dd>{readableSeconds(extra)}</dd>
      <dt>Charged</dt><dd>{readableSeconds(billed)}</dd>
    </dl>
  );
}

export function Result({ state, actions }: Props) {
  const r = state.result;
  if (!r) {
    return (
      <>
        <BackHeader title={state.project?.name} onBack={actions.backToProject} />
        <Body><WaitRow label="Loading the result" /></Body>
      </>
    );
  }
  if (r.status === 'completed') {
    return (
      <>
        <BackHeader title={state.project?.name} onBack={actions.backToProject} />
        <Body>
          <span className="big-ok"><Check /></span>
          <h3>Pull request ready to review</h3>
          <div className="pr">
            <div className="top"><PullRequest className="ico ok" /><b>{r.screens.join(', ') || 'Screens'}</b><span className="pill-ok">Open</span></div>
            {r.branch && <div className="br"><Branch className="ico" /><span>{r.branch} → {r.baseBranch}</span></div>}
            <div className="br"><span>{[r.repository, agentLabel(r.agent)].filter(Boolean).join(' · ')}</span></div>
          </div>
          <Charge billed={r.billedSeconds} buffer={r.startBufferSeconds} />
        </Body>
        <Footer>
          <a className="btn btn-primary" href={r.pullRequestUrl || '#'} target="_blank" rel="noreferrer"><External />Open pull request</a>
          <button type="button" className="btn btn-ghost" onClick={actions.backToProject}>Back to project</button>
        </Footer>
      </>
    );
  }
  return (
    <>
      <BackHeader title={state.project?.name} onBack={actions.back} />
      <Body>
        <h3>The build didn't finish</h3>
        <div className="banner bad" role="alert">
          <Alert className="ico" />
          <p><b>No pull request was opened.</b> {r.error ? <>The build stopped with: <span className="mono">{r.error}</span></> : null}</p>
        </div>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        <Charge billed={r.billedSeconds} buffer={r.startBufferSeconds} />
        <p className="lede flush">{state.plan ? 'Your screens and plan are kept. Try again, or switch the model first.' : 'Open the project to build again.'}</p>
      </Body>
      <Footer>
        <button type="button" className="btn btn-primary" disabled={state.busy === 'starting'} onClick={() => void actions.tryAgain()}><Refresh />Try again</button>
        <button type="button" className="btn btn-ghost" onClick={actions.backToPlan}>{state.plan ? 'Back to plan' : 'Back to project'}</button>
      </Footer>
    </>
  );
}
