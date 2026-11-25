// Flow C: the project page. Repos (with sync state), the account's AI model,
// builds, and the running build. Every task opened from here comes back here.

import React, { useState } from 'react';
import * as api from '../../api/client';
import { BackHeader, Body, Footer, InfoBanner, Messages, Section, Sheet, Spinner, SyncIcon, type SyncKind } from '../components/Chrome';
import { GRADE_LABEL, gradeTone } from '../components/Fidelity';
import { Branch, Model, PullRequest, SyncOk, Warn, XCircle } from '../components/Icons';
import {
  agentDetail,
  agentLabel,
  clock,
  prNumber,
  readableSeconds,
  repoName,
  stackLabel,
  type DesignEngineerActions,
  type DesignEngineerState,
  type LinkState,
} from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

/** What's wrong with a link, in words, or null when it's fine. */
export function linkProblem(state: LinkState | undefined, link: api.RepoLink): string | null {
  if (state === 'branch-not-found') return `Branch "${link.branch}" not found`;
  if (state === 'repo-not-found') return 'Repository not reachable';
  if (state === 'github') return 'GitHub needs reconnecting';
  return null;
}

export function linkSyncKind(state: LinkState | undefined): SyncKind {
  if (state === 'ok') return 'ok';
  if (state === 'checking') return 'run';
  if (!state || state === 'unknown') return 'unknown';
  return 'warn';
}

function linkKey(link: api.RepoLink, state: LinkState | undefined) {
  const parts: string[] = [];
  if (link.isDefault) parts.push('Default');
  const problem = linkProblem(state, link);
  const stack = stackLabel(link.stack);
  if (stack) parts.push(link.stackSource === 'detected' ? `${stack}, detected` : stack);
  else if (!problem) parts.push('Stack not chosen');
  if (problem) parts.push(problem.charAt(0).toLowerCase() + problem.slice(1));
  return parts.join(' · ');
}

export function ProjectPage({ state, actions }: Props) {
  const p = state.project;
  const running = state.runningJob && p && state.runningJob.projectId === p.id ? state.runningJob : null;
  const [showAll, setShowAll] = useState(false);
  if (!p) {
    return (
      <>
        <BackHeader onBack={actions.back} label="Projects" />
        <Body><Messages error={state.error} notice={state.notice} /><div className="wait"><Spinner /><span className="t">Opening project</span></div></Body>
      </>
    );
  }
  const links = state.links;
  const m = state.accountModel;
  const builds = showAll ? state.builds : state.builds.slice(0, 3);
  const linkSheet = state.sheet?.kind === 'link' ? links.find((l) => l.id === (state.sheet as { linkId: string }).linkId) || null : null;

  let primary: React.ReactNode;
  if (running) {
    primary = <button type="button" className="btn btn-primary" onClick={actions.viewRunning}>View running build</button>;
  } else if (!links.length) {
    primary = <button type="button" className="btn btn-primary" disabled>Link a repo to build</button>;
  } else {
    primary = <button type="button" className="btn btn-primary" onClick={actions.startBuild}>Build screens</button>;
  }

  return (
    <>
      <BackHeader title={p.name} onBack={actions.back} label="Projects" onMore={() => actions.setSheet({ kind: 'project' })} />
      <Body className="scroll">
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        {running && (
          <button type="button" className="runbar" onClick={actions.viewRunning}>
            <Spinner />
            <span><b>Building {running.screens.length} screen{running.screens.length === 1 ? '' : 's'}</b> into {repoName(running.repository)}</span>
            <time>{clock(state.now - running.startedAt)}</time>
          </button>
        )}

        <Section
          title="Repos"
          action={links.length > 0 && state.linksAvailable ? (
            <button type="button" className="link" onClick={() => actions.startLink('new')}>+ Link another</button>
          ) : undefined}
        />
        <div className="set" aria-label="Linked repos">
          {links.length === 0 ? (
            <div className="r empty-r">
              <SyncIcon kind="off" />
              <span><span className="v">{state.loadingProject ? 'Loading…' : 'No repo linked yet'}</span></span>
              {!state.loadingProject && <button type="button" className="btn btn-primary btn-sm" onClick={() => actions.startLink('new')}>Link a repo</button>}
            </div>
          ) : (
            links.map((l) => {
              const ls = state.linkStates[l.id];
              const problem = linkProblem(ls, l);
              return (
                <div className="r" key={l.id}>
                  <SyncIcon kind={linkSyncKind(ls)} />
                  <span>
                    <span className="k">{linkKey(l, ls)}</span>
                    <span className="v">{l.repository} <small>@ {l.branch}</small></span>
                  </span>
                  <button type="button" className="link small" onClick={() => actions.setSheet({ kind: 'link', linkId: l.id })} aria-label={`${problem ? 'Fix' : 'Edit'} ${l.repository} ${l.branch}`}>
                    {problem ? 'Fix' : 'Edit'}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <Section title="AI model" />
        <div className="set">
          {m ? (
            <div className="r">
              <span className="glyph"><Model /></span>
              <span>
                <span className="k">Your account · all projects</span>
                <span className="v">{agentLabel(m.agent)} <small>{m.agent === 'codex' && state.codexUser ? state.codexUser : agentDetail(m)}</small></span>
              </span>
              {running ? <span className="tag">Locked while building</span> : <button type="button" className="link small" onClick={actions.openModel}>Switch</button>}
            </div>
          ) : (
            <div className="r empty-r">
              <span className="glyph"><Model /></span>
              <span><span className="v">Not chosen yet</span></span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={actions.openModel}>Choose</button>
            </div>
          )}
        </div>

        <Section
          title="Builds"
          action={state.builds.length > 3 ? <button type="button" className="link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Fewer' : 'All'}</button> : undefined}
        />
        {state.builds.length === 0 ? (
          <div className="set">
            <div className="r empty-r">
              <span className="glyph"><PullRequest /></span>
              <span><span className="v">No builds yet</span></span>
              <span />
            </div>
          </div>
        ) : (
          <div className="hist">
            {builds.map((b) => {
              const pr = prNumber(b.pullRequestUrl);
              const bits = [b.repository ? repoName(b.repository) : null, b.agent ? agentLabel(b.agent) : null, b.billedSeconds != null ? readableSeconds(b.billedSeconds) : null].filter(Boolean);
              const title = b.screenCount != null ? `${b.screenCount} screen${b.screenCount === 1 ? '' : 's'}` : 'Build';
              const when = new Date(b.createdAt);
              return (
                <button type="button" className="h history-action" key={b.jobId} onClick={() => void actions.openBuildHistory(b)} disabled={state.busy === 'history'} aria-label={`View ${title} build details`}>
                  <span className="tx">
                    <b>{title}{isNaN(when.getTime()) ? '' : ` · ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}</b>
                    <span>{bits.join(' · ') || ' '}</span>
                  </span>
                  {b.status === 'completed' && b.fidelity && (
                    <span className={`tag fid-tag ${gradeTone(b.fidelity.grade)}`} title={`Design fidelity ${Math.round(b.fidelity.score)}/100 · ${GRADE_LABEL[b.fidelity.grade]}`}>
                      {Math.round(b.fidelity.score)}% match
                    </span>
                  )}
                  {b.status === 'completed' ? (
                    b.pullRequestUrl ? (
                      <span className="tag ok">{pr ? `PR #${pr}` : 'PR'}</span>
                    ) : <span className="tag ok">Done</span>
                  ) : b.status === 'failed' || b.status === 'cancelled' ? (
                    <span className="tag bad">Failed</span>
                  ) : (
                    <span className="tag run">Running</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Body>
      <Footer>{primary}</Footer>
      {linkSheet && <LinkSheet link={linkSheet} state={state} actions={actions} />}
      {state.sheet?.kind === 'project' && <ProjectSheet state={state} actions={actions} />}
    </>
  );
}

function LinkSheet({ link, state, actions }: Props & { link: api.RepoLink }) {
  const [confirm, setConfirm] = useState(false);
  const ls = state.linkStates[link.id];
  const problem = linkProblem(ls, link);
  return (
    <Sheet label={link.repository} onClose={() => actions.setSheet(null)}>
      <h4 className="sheet-h">{link.repository}</h4>
      {ls === 'branch-not-found' && (
        <InfoBanner tone="warn"><b>Branch "{link.branch}" wasn't found.</b> It may have been merged or deleted. Choose another branch to keep building here.</InfoBanner>
      )}
      {ls === 'repo-not-found' && (
        <InfoBanner tone="warn"><b>This repository can't be reached.</b> It may have been renamed, deleted or made private to you. Unlink it, or reconnect GitHub with access.</InfoBanner>
      )}
      {ls === 'github' && (
        <InfoBanner tone="warn"><b>Reconnect GitHub.</b> Design Engineer can't read this repo until GitHub is connected again.</InfoBanner>
      )}
      {!problem && ls === 'ok' && (
        <InfoBanner tone="ok">Synced. Builds branch off <b>{link.branch}</b> and open a pull request into it.</InfoBanner>
      )}
      {confirm ? (
        <div className="prow confirm">
          <p><b>Unlink {link.repository} @ {link.branch}?</b> The repo on GitHub isn't changed.</p>
          <div className="acts">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Keep</button>
            <button type="button" className="btn btn-danger btn-sm" disabled={state.busy === 'unlink'} onClick={() => void actions.unlink(link.id)}>Unlink</button>
          </div>
        </div>
      ) : (
        <div>
          {ls === 'github' && (
            <div className="slink">
              <Warn className="ico" />
              <span className="tx"><b>Reconnect GitHub</b><span>Then choose the branch again</span></span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => actions.startLink('branch', link.id)}>Reconnect</button>
            </div>
          )}
          <div className="slink">
            <Branch className="ico" />
            <span className="tx"><b>Change branch</b><span>Currently {link.branch}</span></span>
            <button type="button" className={`btn btn-sm ${ls === 'branch-not-found' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => actions.startLink('branch', link.id)}>Choose</button>
          </div>
          <div className="slink">
            <Model className="ico" />
            <span className="tx"><b>Stack</b><span>{stackLabel(link.stack) || 'Not chosen yet'}{link.stackSource === 'detected' ? ', detected' : ''}</span></span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.openStackFor(link.id)}>Change</button>
          </div>
          {state.linksAvailable && !link.isDefault && (
            <button type="button" className="slink as-button" onClick={() => void actions.makeDefaultLink(link.id)}>
              <SyncOk className="ico" />
              <span className="tx"><b>Make default</b><span>Preselected when you build</span></span>
            </button>
          )}
          <button type="button" className="slink as-button danger" onClick={() => setConfirm(true)}>
            <XCircle className="ico" />
            <span className="tx"><b>Unlink from project</b><span>The repo on GitHub isn't changed</span></span>
          </button>
        </div>
      )}
    </Sheet>
  );
}

function ProjectSheet({ state, actions }: Props) {
  const p = state.project!;
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu');
  const [name, setName] = useState(p.name);
  return (
    <Sheet label="Project" onClose={() => actions.setSheet(null)}>
      <h4 className="sheet-h">{p.name}</h4>
      {mode === 'rename' ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void actions.renameProject(p.id, name);
            actions.setSheet(null);
          }}
        >
          <label className="field">
            <span className="field-label">Project name</span>
            <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setMode('menu')}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>Save</button>
          </div>
        </form>
      ) : mode === 'delete' ? (
        <div className="prow confirm">
          <p><b>Delete {p.name}?</b> Its saved screens and repo links are removed too. Nothing on GitHub is changed.</p>
          <div className="acts">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('menu')}>Keep</button>
            <button type="button" className="btn btn-danger btn-sm" disabled={state.busy === 'delete'} onClick={() => void actions.deleteProject(p.id)}>Delete project</button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className="slink as-button" onClick={() => setMode('rename')}>
            <span className="tx"><b>Rename</b><span>Change the project's name</span></span>
          </button>
          <button type="button" className="slink as-button danger" onClick={() => setMode('delete')}>
            <XCircle className="ico" />
            <span className="tx"><b>Delete project</b><span>Removes its screens and links</span></span>
          </button>
        </div>
      )}
    </Sheet>
  );
}
