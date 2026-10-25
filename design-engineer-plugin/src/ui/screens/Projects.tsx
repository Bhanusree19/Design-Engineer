import React, { FormEvent, useEffect, useState } from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, WaitRow, Who } from '../components/Chrome';
import { Repo } from '../components/Icons';
import SearchList from '../components/SearchList';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

export default function Projects({ state, actions }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(state.selectedProject?.id || null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState('');
  const loading = state.waiting === 'projects';
  const creatingProject = state.waiting === 'create-project';
  const deletingProject = state.waiting === 'delete-project';
  const selectedProject = state.projects.find((project) => project.id === selectedId);

  useEffect(() => {
    if (selectedId && !state.projects.some((project) => project.id === selectedId)) {
      setSelectedId(null);
      setConfirmDelete(false);
    }
  }, [selectedId, state.projects]);
  const items = state.projects.map((project) => ({
    id: project.id,
    searchText: `${project.name} ${project.repository || ''}`,
    render: (
      <>
        <Repo className="ico" />
        <span className="nm"><b>{project.name}</b></span>
        {project.repository && <span className="meta">{project.repository}</span>}
      </>
    ),
  }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (cleanName) void actions.createProject(cleanName);
  }

  const header = (
    <Header state={state} actions={actions}>
      {state.githubUser && <Who name={`@${state.githubUser}`} />}
    </Header>
  );

  return (
    <>
      {header}
      <Rail step="project" />
      <Body>
        <h1>{creating ? 'Create a project' : 'Choose a project'}</h1>
        {state.error && <ErrorBanner message={state.error} />}
        {!creating && <p className="lede">Choose an existing project or create a new one before selecting its GitHub repository.</p>}
        {loading && <WaitRow label="Loading projects" />}
        {creatingProject && <WaitRow label="Creating project" />}
        {deletingProject && <WaitRow label="Deleting project" />}
        {!loading && !creatingProject && !deletingProject && (
          creating ? (
            <form id="create-project-form" className="auth-form" onSubmit={submit}>
              <label className="auth-field">
                Project name
                <input
                  autoFocus
                  autoComplete="off"
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Mobile app redesign"
                />
              </label>
            </form>
          ) : (
            <>
              {state.projects.length === 0 ? (
                <div className="empty project-empty">
                  <p>You don’t have any projects yet. Create one to get started.</p>
                </div>
              ) : (
                <>
                  <SearchList
                    id="search-projects"
                    items={items}
                    selectedId={selectedId}
                    onSelect={(id) => {
                      setSelectedId(id);
                      setConfirmDelete(false);
                    }}
                    onConfirm={actions.chooseProject}
                    placeholder="Search projects"
                    countLabel={(shown, total) =>
                      shown === total ? `${total} ${total === 1 ? 'project' : 'projects'}` : `${shown} of ${total} projects`
                    }
                    emptyLabel="No projects match that search."
                  />
                  {selectedProject && !confirmDelete && (
                    <button className="project-delete" type="button" onClick={() => setConfirmDelete(true)}>
                      Delete selected project
                    </button>
                  )}
                  {confirmDelete && selectedProject && (
                    <div className="delete-confirm" role="alert">
                      Delete <b>{selectedProject.name}</b>? This also removes its saved design context and cannot be undone.
                    </div>
                  )}
                </>
              )}
            </>
          )
        )}
      </Body>
      <Footer>
        <button className="btn btn-ghost" type="button" onClick={creating ? () => setCreating(false) : actions.goBack} disabled={loading || creatingProject || deletingProject}>
          {creating ? 'Cancel' : 'Back to GitHub'}
        </button>
        {creating ? (
          <button className="btn btn-primary" type="submit" form="create-project-form" disabled={!name.trim() || creatingProject || deletingProject}>
            {creatingProject ? 'Creating…' : 'Create project'}
          </button>
        ) : confirmDelete ? (
          <div className="btn-row">
            <button className="btn btn-ghost" type="button" onClick={() => setConfirmDelete(false)} disabled={deletingProject}>Cancel</button>
            <button
              className="btn btn-danger"
              type="button"
              disabled={deletingProject}
              onClick={() => selectedId && void actions.deleteProject(selectedId).then((deleted) => {
                if (deleted) {
                  setSelectedId(null);
                  setConfirmDelete(false);
                }
              })}
            >
              {deletingProject ? 'Deleting…' : 'Delete project'}
            </button>
          </div>
        ) : (
          <div className="btn-row">
            <button className="btn btn-ghost" type="button" onClick={() => setCreating(true)} disabled={loading || deletingProject}>
              Create project
            </button>
            <button className="btn btn-primary" type="button" onClick={() => selectedId && void actions.chooseProject(selectedId)} disabled={!selectedId || loading || deletingProject}>
              Continue
            </button>
          </div>
        )}
      </Footer>
    </>
  );
}
