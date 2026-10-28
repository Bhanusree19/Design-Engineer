import React, { FormEvent, useEffect, useState } from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, WaitRow, Who } from '../components/Chrome';
import { Lock, Refresh, Repo } from '../components/Icons';
import SearchList from '../components/SearchList';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

const NEW_PROJECT = 'new';

export default function Projects({ state, actions }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(state.selectedProject?.id || null);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(state.selectedRepo);
  const [name, setName] = useState('');
  const loadingProjects = state.waiting === 'projects';
  const loadingRepos = state.waiting === 'repos';
  const creatingProject = state.waiting === 'create-project';
  const loading = loadingProjects || loadingRepos || creatingProject;
  const failed = !!state.error && state.repos.length === 0 && !loading;

  useEffect(() => {
    setSelectedId(state.selectedProject?.id || null);
    setSelectedRepo(state.selectedProject?.repository || null);
  }, [state.selectedProject?.id]);

  const repoItems = state.repos.map((repo) => {
    const [owner, repoName] = repo.fullName.split('/');
    return {
      id: repo.fullName,
      searchText: repo.fullName,
      render: (
        <>
          <Repo className="ico" />
          <span className="nm"><span className="own">{owner}/</span><b>{repoName}</b></span>
          {repo.private && <span className="meta"><Lock className="ico" />Private</span>}
        </>
      ),
    };
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;

    const project = await actions.createProject(cleanName);
    if (project) {
      setSelectedId(project.id);
      setName('');
    }
  }

  async function continueToBranches() {
    if (!selectedId || selectedId === NEW_PROJECT || !selectedRepo) return;
    const project = actions.chooseProject(selectedId);
    if (project) await actions.chooseRepo(selectedRepo);
  }

  return (
    <>
      <Header state={state} actions={actions}>
        {state.githubUser && <Who name={`@${state.githubUser}`} />}
      </Header>
      <Rail step="project" />
      <Body>
        <h1>Project &amp; repository</h1>
        {state.error && <ErrorBanner message={state.error} />}
        <div className="project-fields">
          <label className="auth-field" htmlFor="project-choice">
            Project
            <select
              id="project-choice"
              value={selectedId || ''}
              disabled={loadingProjects || creatingProject}
              onChange={(event) => {
                const id = event.target.value;
                setSelectedId(id || null);
                if (id === NEW_PROJECT) {
                  setSelectedRepo(null);
                } else if (id) {
                  actions.chooseProject(id);
                }
              }}
            >
              <option value="">Choose a project</option>
              <option value={NEW_PROJECT}>Create a new project</option>
              {state.projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          {selectedId === NEW_PROJECT && (
            <form className="new-project-form" onSubmit={submit}>
              <label className="auth-field" htmlFor="new-project-name">
                New project name
                <input
                  id="new-project-name"
                  autoComplete="off"
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Mobile app redesign"
                />
              </label>
              <button className="btn btn-ghost" type="submit" disabled={!name.trim() || creatingProject}>
                {creatingProject ? 'Creating…' : 'Create project'}
              </button>
            </form>
          )}
        </div>

        <div className="repo-picker">
          <h2>GitHub repository</h2>
          {loadingProjects && <WaitRow label="Loading projects and repositories" />}
          {loadingRepos && <WaitRow label="Loading repositories" />}
          {!loadingProjects && !loadingRepos && failed ? (
            <button className="btn btn-ghost" type="button" onClick={actions.loadProjects}>
              <Refresh />
              Reload projects and repositories
            </button>
          ) : !loadingProjects && !loadingRepos ? (
            <SearchList
              id="search-repos"
              items={repoItems}
              selectedId={selectedRepo}
              onSelect={setSelectedRepo}
              onConfirm={setSelectedRepo}
              placeholder="Search repositories"
              countLabel={(shown, total) =>
                shown === total ? `${total} ${total === 1 ? 'repository' : 'repositories'}` : `${shown} of ${total} repositories`
              }
              emptyLabel="No repositories match that search."
            />
          ) : null}
        </div>
      </Body>
      <Footer>
        <button className="btn btn-ghost" type="button" onClick={actions.goBack} disabled={loading}>
          Back to GitHub
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void continueToBranches()}
          disabled={!selectedId || selectedId === NEW_PROJECT || !selectedRepo || loading}
        >
          {selectedRepo ? `Use ${selectedRepo.split('/').pop()}` : 'Choose a project and repository'}
        </button>
      </Footer>
    </>
  );
}
