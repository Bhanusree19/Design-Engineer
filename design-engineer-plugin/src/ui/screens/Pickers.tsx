// Steps 3 and 4: choose a repository, then a branch.

import React, { useEffect, useState } from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, WaitRow, Who } from '../components/Chrome';
import { Branch, Lock, Refresh, Repo } from '../components/Icons';
import SearchList from '../components/SearchList';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

function PickerHeader({ state }: { state: DesignEngineerState }) {
  const name = state.githubUser ? `@${state.githubUser}` : state.codexUser;
  return <Header>{name && <Who name={name} />}</Header>;
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
      <PickerHeader state={state} />
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
  const [highlight, setHighlight] = useState<string | null>(null);
  const loading = state.waiting === 'branches';
  const failed = !!state.error && state.branches.length === 0;

  // Preselect the usual default branch so most people only press Enter.
  useEffect(() => {
    if (highlight || state.branches.length === 0) return;
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
      <PickerHeader state={state} />
      <Rail step="branch" />
      <Body>
        <h1>Choose a branch</h1>
        <div className="ctx">
          <Repo className="ico" />
          <span className="ctx-name">{state.selectedRepo}</span>
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
            countLabel={(shown, total) =>
              shown === total ? `${total} ${total === 1 ? 'branch' : 'branches'}` : `${shown} of ${total} branches`
            }
            emptyLabel="No branches match that search."
          />
        )}
      </Body>
      <Footer>
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
