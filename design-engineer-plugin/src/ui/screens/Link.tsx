// Flow D: link a GitHub repo to the project. GitHub authorization only when
// needed, then repo → branch → reading the repo → (stack, if no app found).

import React, { useEffect, useState } from 'react';
import { BackHeader, Body, Footer, Messages, Spinner, WaitRow } from '../components/Chrome';
import RepoContextCard from '../components/RepoContextCard';
import SearchList from '../components/SearchList';
import { Branch, Check, External, Github, Lock, Phone, Repo, Shield, Web } from '../components/Icons';
import type { Stack } from '../../api/client';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

function title(state: DesignEngineerState) {
  if (!state.linkFlow) return 'GitHub';
  return state.linkFlow.mode === 'branch' ? 'Change branch' : 'Link a repo';
}

export function LinkGithub({ state, actions }: Props) {
  const waiting = !!state.route.params?.waiting;
  if (waiting) {
    return (
      <>
        <BackHeader title={title(state)} onBack={actions.cancelGithub} />
        <Body>
          <h3>Finish in your browser</h3>
          <p className="lede">Authorize Design Engineer on GitHub, then come back here. This screen moves on by itself.</p>
          <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
          <div className="grow" />
          <WaitRow label="Waiting for GitHub" />
        </Body>
        <Footer>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={actions.cancelGithub}>Cancel</button>
            <button type="button" className="btn btn-ghost" onClick={actions.reopenGithub}><External />Reopen GitHub</button>
          </div>
        </Footer>
      </>
    );
  }
  return (
    <>
      <BackHeader title={title(state)} onBack={actions.back} />
      <Body>
        <h3>Connect GitHub</h3>
        <p className="lede">Design Engineer needs access to your repos to read your code and open pull requests.</p>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        <div className="points">
          <div><Shield className="ico" /><span>The connection is saved on your account. Nothing is stored on this computer.</span></div>
          <div><Lock className="ico" /><span>Private repos show up if you grant access.</span></div>
        </div>
      </Body>
      <Footer hint="Opens github.com in your browser">
        <button type="button" className="btn btn-primary" onClick={() => void actions.connectGithub()}><Github />Connect GitHub</button>
      </Footer>
    </>
  );
}

export function LinkRepo({ state, actions }: Props) {
  const repos = state.repos;
  const [selected, setSelected] = useState<string | null>(null);
  const linked = new Set(state.links.map((l) => l.repository));
  // Require an explicit click instead of silently selecting the first repo.
  useEffect(() => { setSelected(null); }, [repos]);
  const short = selected ? selected.split('/').pop() : null;
  return (
    <>
      <BackHeader title={title(state)} onBack={actions.back} />
      <Body>
        <h3>Choose a repository</h3>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        {repos === null ? (
          <WaitRow label="Loading your repositories" />
        ) : repos.length === 0 ? (
          <div className="empty">
            <div>
              <h5>No repositories found</h5>
              <p>Create a repo on GitHub, or grant Design Engineer access to the ones you want.</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void actions.loadRepos()}>Refresh</button>
            </div>
          </div>
        ) : (
          <SearchList
            id="repo-search"
            items={repos.map((r) => {
              const [owner, name] = r.fullName.split('/');
              return {
                id: r.fullName,
                searchText: r.fullName,
                render: (
                  <>
                    <Repo className="ico" />
                    <span className="nm"><span className="own">{owner}/</span><b>{name}</b></span>
                    {linked.has(r.fullName) ? <span className="meta">Linked</span> : r.private ? <span className="meta"><Lock className="ico" />Private</span> : null}
                  </>
                ),
              };
            })}
            selectedId={selected}
            onSelect={setSelected}
            onConfirm={(id) => actions.chooseLinkRepo(id)}
            placeholder="Search repositories"
            countLabel={(shown, total) => `${shown} of ${total} repositor${total === 1 ? 'y' : 'ies'}`}
            emptyLabel="No repositories match."
          />
        )}
      </Body>
      <Footer>
        <button type="button" className="btn btn-primary" disabled={!selected} onClick={() => selected && actions.chooseLinkRepo(selected)}>
          {short ? 'Use repository' : 'Select repository'}
        </button>
      </Footer>
    </>
  );
}

export function LinkBranch({ state, actions }: Props) {
  const repository: string = state.route.params?.repository || state.linkFlow?.repository || '';
  const branches = state.branches;
  const current = state.linkFlow?.mode === 'branch' ? state.linkFlow.branch : null;
  const taken = new Set(state.links.filter((l) => l.repository === repository && l.branch !== current).map((l) => l.branch));
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (branches && branches.length && !selected) {
      const preferred = branches.find((b) => b.name === 'main') || branches.find((b) => b.name === 'master') || branches[0];
      setSelected(preferred.name);
    }
  }, [branches, selected]);
  const saving = state.busy === 'link';
  return (
    <>
      <BackHeader title={title(state)} onBack={actions.back} />
      <Body>
        <h3>Choose a branch</h3>
        <div className="ctx"><Repo className="ico" /><span>{repository}</span></div>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        {branches === null ? (
          <WaitRow label="Loading branches" />
        ) : (
          <SearchList
            id="branch-search"
            items={branches.map((b) => ({
              id: b.name,
              searchText: b.name,
              render: (
                <>
                  <Branch className="ico" />
                  <span className="nm"><b>{b.name}</b></span>
                  {b.name === current ? <span className="meta">Current</span> : taken.has(b.name) ? <span className="meta">Linked</span> : null}
                </>
              ),
            }))}
            selectedId={selected}
            onSelect={setSelected}
            onConfirm={(id) => void actions.confirmLinkBranch(id)}
            placeholder="Search branches"
            countLabel={(shown, total) => `${shown} of ${total} branch${total === 1 ? '' : 'es'}`}
            emptyLabel="No branches match."
          />
        )}
        <p className="lede flush small">Each build makes its own branch from this one and opens a pull request into it.</p>
      </Body>
      <Footer>
        <button type="button" className="btn btn-primary" disabled={!selected || saving} onClick={() => selected && void actions.confirmLinkBranch(selected)}>
          {saving ? 'Linking…' : selected ? `Link ${selected}` : 'Choose a branch'}
        </button>
      </Footer>
    </>
  );
}

export function LinkReading({ state, actions }: Props) {
  const repository = state.route.params?.repository || state.linkFlow?.repository || 'the repo';
  return (
    <>
      <BackHeader title={title(state)} onBack={actions.back} />
      <Body>
        <h3>Reading {repository}</h3>
        <p className="lede">Looking for an existing app so the build matches your code.</p>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        <div className="timeline">
          <div><Check className="ico" /><span>Linked {state.route.params?.branch}</span><time /></div>
          <div className="cur"><Spinner /><span>Finding the framework, components and screens</span><time /></div>
        </div>
      </Body>
      <Footer>
        <button type="button" className="btn btn-primary" disabled>Reading…</button>
      </Footer>
    </>
  );
}

const STACKS: { id: Stack; name: string; detail: string; Icon: typeof Phone }[] = [
  { id: 'react-native', name: 'React Native', detail: 'Mobile app for iOS and Android', Icon: Phone },
  { id: 'react-js', name: 'React JS', detail: 'Web app that runs in the browser', Icon: Web },
];

export function LinkStack({ state, actions }: Props) {
  const context = state.route.params?.context || state.readingContext;
  const initial: Stack = state.project?.stack || context?.stack || 'react-js';
  const [stack, setStack] = useState<Stack>(initial);
  const heading = !context
    ? 'Choose the stack'
    : context.status === 'empty' || context.status === 'no-app'
      ? 'This branch has no app yet'
      : context.status === 'multiple-apps'
        ? 'This branch has more than one app'
        : context.status === 'existing-app'
          ? 'Confirm the stack'
          : 'Choose the stack';
  const saving = state.busy === 'stack';
  return (
    <>
      <BackHeader title={title(state)} onBack={actions.back} />
      <Body className="scroll">
        <h3>{heading}</h3>
        <p className="lede">Choose what the build should create.</p>
        <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        {context && context.status !== 'empty' && <RepoContextCard context={context} source={state.project?.stack_source} />}
        <div className="stack-pick" role="radiogroup" aria-label="Stack">
          {STACKS.map(({ id, name, detail, Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={stack === id} className={`sp ${stack === id ? 'on' : ''}`} onClick={() => setStack(id)}>
              <span className="dev"><Icon /></span>
              <b>{name}</b>
              <span className="radio" />
              <span className="det">{detail}</span>
            </button>
          ))}
        </div>
      </Body>
      <Footer>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void actions.chooseLinkStack(stack)}>
          {saving ? 'Saving…' : `Use ${STACKS.find((s) => s.id === stack)!.name}`}
        </button>
      </Footer>
    </>
  );
}
