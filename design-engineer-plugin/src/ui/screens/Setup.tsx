// Project setup: repository, base branch, stack.

import React, { useEffect, useState } from 'react';
import { Body, ErrorBanner, Footer, ProjectHeader, Rail, WaitRow } from '../components/Chrome';
import { Branch, Lock, Phone, Refresh, Repo, Web } from '../components/Icons';
import SearchList from '../components/SearchList';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';
import { stackLabel } from '../hooks/useDesignEngineer';
import type { Stack } from '../../api/client';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

export function SetupHeader({ state, actions }: Props) {
  return (
    <ProjectHeader
      name={state.currentProject?.name || 'Project'}
      repo={state.selectedRepo}
      branch={state.selectedBranch}
      onBack={actions.backToProjects}
      onRoute={actions.changeSetup}
    />
  );
}

// -----------------------------------------------------------------------------
// REPOSITORY
// -----------------------------------------------------------------------------

export function RepoStep({ state, actions }: Props) {
  const [highlight, setHighlight] = useState<string | null>(state.selectedRepo);
  const loading = state.waiting === 'repos';
  const failed = !!state.error && state.repos.length === 0;

  const items = state.repos.map((repo) => {
    const [owner, name] = repo.fullName.split('/');
    return {
      id: repo.fullName,
      searchText: repo.fullName,
      render: (
        <>
          <Repo className="ico" />
          <span className="nm"><span className="own">{owner}/</span><b>{name}</b></span>
          {repo.private && <span className="meta"><Lock className="ico" />Private</span>}
        </>
      ),
    };
  });

  const chosenName = highlight ? highlight.split('/').pop() : null;

  return (
    <>
      <ProjectHeader name={state.currentProject?.name || 'Project'} onBack={actions.backToProjects} />
      <Rail step="repo" />
      <Body>
        <h1>Choose a repository</h1>
        {state.error && <ErrorBanner message={state.error} />}
        {loading && <WaitRow label="Loading repositories" />}
        {!loading && !failed && (
          <SearchList
            id="search-repos"
            items={items}
            selectedId={highlight}
            onSelect={setHighlight}
            onConfirm={actions.chooseRepo}
            placeholder="Search repositories"
            countLabel={(shown, total) =>
              shown === total ? `${total} ${total === 1 ? 'repository' : 'repositories'}` : `${shown} of ${total} repositories`
            }
            emptyLabel="No repositories match that search."
          />
        )}
      </Body>
      <Footer>
        {failed ? (
          <button className="btn btn-primary" type="button" onClick={actions.loadRepos}>
            <Refresh />
            Try again
          </button>
        ) : (
          <button className="btn btn-primary" type="button" disabled={!highlight || loading} onClick={() => highlight && actions.chooseRepo(highlight)}>
            {chosenName ? `Use ${chosenName}` : 'Choose a repository'}
          </button>
        )}
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// BRANCH
// -----------------------------------------------------------------------------

export function BranchStep({ state, actions }: Props) {
  const [highlight, setHighlight] = useState<string | null>(state.currentProject?.base_branch || null);
  const loading = state.waiting === 'branches';
  const failed = !!state.error && state.branches.length === 0;

  // Preselect the saved or usual default branch so most people only press Enter.
  useEffect(() => {
    if (state.branches.length === 0) return;
    if (highlight && state.branches.some((b) => b.name === highlight)) return;
    const preferred = state.branches.find((b) => b.name === 'main' || b.name === 'master');
    setHighlight((preferred || state.branches[0]).name);
  }, [state.branches, highlight]);

  const items = state.branches.map((branch) => ({
    id: branch.name,
    searchText: branch.name,
    render: (
      <>
        <Branch className="ico" />
        <span className="nm"><b>{branch.name}</b></span>
      </>
    ),
  }));

  return (
    <>
      <ProjectHeader name={state.currentProject?.name || 'Project'} onBack={actions.backToProjects} />
      <Rail step="branch" />
      <Body>
        <h1>Choose a base branch</h1>
        <div className="ctx">
          <Repo className="ico" />
          <span>{state.selectedRepo}</span>
          <button className="link" type="button" onClick={actions.changeRepo}>Change</button>
        </div>
        {state.error && <ErrorBanner message={state.error} />}
        {loading && <WaitRow label="Loading branches" />}
        {!loading && !failed && (
          <SearchList
            id="search-branches"
            items={items}
            selectedId={highlight}
            onSelect={setHighlight}
            onConfirm={actions.chooseBranch}
            placeholder="Search branches"
            countLabel={(shown, total) => (shown === total ? `${total} ${total === 1 ? 'branch' : 'branches'}` : `${shown} of ${total} branches`)}
            emptyLabel="No branches match that search."
          />
        )}
        {!loading && !failed && <p className="lede flat small">Codex creates its own branch from this one. Your base branch isn't changed.</p>}
      </Body>
      <Footer>
        {failed ? (
          <button className="btn btn-primary" type="button" onClick={actions.changeBranch}>
            <Refresh />
            Try again
          </button>
        ) : (
          <button className="btn btn-primary" type="button" disabled={!highlight || loading} onClick={() => highlight && actions.chooseBranch(highlight)}>
            {highlight ? `Use ${highlight}` : 'Choose a branch'}
          </button>
        )}
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// STACK
// -----------------------------------------------------------------------------

const STACKS: { id: Stack; title: string; blurb: string; icon: React.ReactNode }[] = [
  { id: 'react-native', title: 'React Native', blurb: 'Mobile app for iOS and Android', icon: <Phone /> },
  { id: 'react-js', title: 'React JS', blurb: 'Web app that runs in the browser', icon: <Web /> },
];

export function StackStep({ state, actions }: Props) {
  const [choice, setChoice] = useState<Stack>(state.selectedStack || state.currentProject?.stack || 'react-native');

  return (
    <>
      <SetupHeader state={state} actions={actions} />
      <Rail step="stack" />
      <Body>
        <h1>What should Codex build?</h1>
        <p className="lede">The code and folder structure follow this choice.</p>
        <div className="stack-pick" role="radiogroup" aria-label="Stack">
          {STACKS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={choice === s.id}
              className={`sp ${choice === s.id ? 'on' : ''}`}
              onClick={() => setChoice(s.id)}
              onDoubleClick={() => actions.chooseStack(s.id)}
            >
              <span className="dev">{s.icon}</span>
              <b>{s.title}</b>
              <span className="radio" aria-hidden="true" />
              <span className="blurb">{s.blurb}</span>
            </button>
          ))}
        </div>
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" onClick={() => actions.chooseStack(choice)}>
          Continue with {stackLabel(choice)}
        </button>
      </Footer>
    </>
  );
}
