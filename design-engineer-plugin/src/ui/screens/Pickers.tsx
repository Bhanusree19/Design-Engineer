// Steps 3 and 4: choose a repository, then a branch.

import React, { useEffect, useState } from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, WaitRow, Who } from '../components/Chrome';
import { Branch, Lock, Refresh, Repo } from '../components/Icons';
import SearchList from '../components/SearchList';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

function PickerHeader({ state, actions }: Props) {
  const name = state.githubUser ? `@${state.githubUser}` : state.codexUser;
  return <Header state={state} actions={actions}>{name && <Who name={name} />}</Header>;
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
      <PickerHeader state={state} actions={actions} />
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
        <button className="btn btn-ghost" type="button" onClick={actions.goBack}>Back</button>
        {failed ? (
          <button className="btn btn-primary" type="button" onClick={actions.loadRepos}>
            <Refresh />
            Try again
          </button>
        ) : (
          <button
            className="btn btn-primary"
            type="button"
            disabled={!highlight || loading}
            onClick={() => highlight && actions.chooseRepo(highlight)}
          >
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
  const [highlight, setHighlight] = useState<string | null>(state.selectedBranch);
  const loading = state.waiting === 'branches' || state.waiting === 'saving';
  const failed = !!state.error && state.branches.length === 0;

  useEffect(() => {
    if (state.selectedBranch && state.branches.some((branch) => branch.name === state.selectedBranch)) {
      setHighlight(state.selectedBranch);
      return;
    }
    if (highlight && state.branches.some((branch) => branch.name === highlight)) return;
    if (state.branches.length === 0) return;
    const preferred = state.branches.find((b) => b.name === 'main' || b.name === 'master');
    setHighlight((preferred || state.branches[0]).name);
  }, [state.branches, state.selectedBranch, highlight]);

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
      <PickerHeader state={state} actions={actions} />
      <Rail step="branch" />
      <Body>
        <h1>Choose a branch</h1>
        <div className="ctx">
          <Repo className="ico" />
          <span className="ctx-name">{state.selectedRepo}</span>
          <button className="link" type="button" onClick={actions.changeRepo}>Change</button>
        </div>
        {state.error && <ErrorBanner message={state.error} />}
        {loading && <WaitRow label={state.waiting === 'saving' ? 'Saving project settings' : 'Loading branches'} />}
        {!loading && !failed && (
          <SearchList
            id="search-branches"
            items={items}
            selectedId={highlight}
            onSelect={setHighlight}
            onConfirm={actions.chooseBranch}
            placeholder="Search branches"
            countLabel={(shown, total) =>
              shown === total ? `${total} ${total === 1 ? 'branch' : 'branches'}` : `${shown} of ${total} branches`
            }
            emptyLabel="No branches match that search."
          />
        )}
      </Body>
      <Footer>
        <button className="btn btn-ghost" type="button" onClick={actions.goBack}>Back to repository</button>
        {failed ? (
          <button className="btn btn-primary" type="button" onClick={actions.changeBranch}>
            <Refresh />
            Try again
          </button>
        ) : (
          <button
            className="btn btn-primary"
            type="button"
            disabled={!highlight || loading}
            onClick={() => highlight && actions.chooseBranch(highlight)}
          >
            {highlight ? `Use ${highlight}` : 'Choose a branch'}
          </button>
        )}
      </Footer>
    </>
  );
}
