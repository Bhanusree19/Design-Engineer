// New project (GitHub first, then name and description) and GitHub connect/reconnect.

import React, { useState } from 'react';
import { BackHeader, Body, ErrorBanner, Footer, ProjectHeader, Rail, SuccessBanner, WaitRow, WarnBanner } from '../components/Chrome';
import { External, GitHub, Lock, Shield } from '../components/Icons';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

// The "finish in your browser" wait, shared by every GitHub connect.
function GithubWait({ actions }: { actions: DesignEngineerActions }) {
  return (
    <>
      <Body>
        <h1>Finish in your browser</h1>
        <p className="lede">Authorize Design Engineer on GitHub, then come back here. This screen moves on by itself.</p>
        <div className="grow" />
        <WaitRow label="Waiting for GitHub" />
      </Body>
      <Footer>
        <div className="btn-row">
          <button className="btn btn-ghost" type="button" onClick={actions.cancelGithub}>Cancel</button>
          <button className="btn btn-ghost" type="button" onClick={actions.reopenGithub}>
            <External />
            Reopen GitHub
          </button>
        </div>
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// NEW PROJECT
// -----------------------------------------------------------------------------

export function NewProject({ state, actions }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const header = <BackHeader label="Projects" onBack={actions.backToProjects} />;

  if (state.waiting === 'github') {
    return (
      <>
        {header}
        <GithubWait actions={actions} />
      </>
    );
  }

  if (!state.github.connected) {
    return (
      <>
        {header}
        <Body>
          <h1>New project</h1>
          <p className="lede">Every project is linked to a GitHub repository. Connect GitHub to continue.</p>
          {state.error && <ErrorBanner message={state.error} />}
          <div className="points">
            <div><Shield className="ico" /><span>Your GitHub connection is stored with your account. Nothing is saved on this computer.</span></div>
            <div><Lock className="ico" /><span>Private repos show up if you grant access.</span></div>
          </div>
        </Body>
        <Footer hint="Opens github.com in your browser">
          <button className="btn btn-primary" type="button" onClick={() => actions.connectGithub('create-project')}>
            <GitHub />
            Connect GitHub
          </button>
        </Footer>
      </>
    );
  }

  const busy = state.waiting === 'project' || state.waiting === 'repos';
  const submit = () => actions.createProject(name, description);

  return (
    <>
      {header}
      <Body>
        <h1>New project</h1>
        {state.error && <ErrorBanner message={state.error} />}
        <div className="field">
          <label htmlFor="np-name">Project name</label>
          <div className={`input ${state.fieldErrors.name ? 'bad' : ''}`}>
            <input
              id="np-name"
              value={name}
              placeholder="My app"
              autoFocus
              aria-invalid={!!state.fieldErrors.name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
          </div>
          {state.fieldErrors.name && <div className="err">{state.fieldErrors.name}</div>}
        </div>
        <div className="field">
          <label htmlFor="np-desc">Description <span>Optional</span></label>
          <div className="input textarea">
            <textarea id="np-desc" value={description} placeholder="What is this app about? Codex reads this." onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <div className="grow" />
        <SuccessBanner>GitHub connected as <b>@{state.github.githubUser}</b></SuccessBanner>
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy}>
          {busy ? 'Creating project…' : 'Create and choose repo'}
        </button>
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// GITHUB STEP (connect from Projects, or reconnect inside a project)
// -----------------------------------------------------------------------------

export function GithubStep({ state, actions }: Props) {
  const project = state.currentProject;
  const header = project ? (
    <ProjectHeader name={project.name} onBack={actions.backToProjects} />
  ) : (
    <BackHeader label="Projects" onBack={actions.backToProjects} />
  );

  if (state.waiting === 'github') {
    return (
      <>
        {header}
        {project && <Rail step="github" />}
        <GithubWait actions={actions} />
      </>
    );
  }

  return (
    <>
      {header}
      {project && <Rail step="github" />}
      <Body>
        <h1>{project ? 'Reconnect GitHub' : 'Connect GitHub'}</h1>
        {state.error ? (
          <WarnBanner>{state.error}</WarnBanner>
        ) : (
          <p className="lede">Connect GitHub so your projects can use your repositories.</p>
        )}
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" onClick={() => actions.connectGithub(project ? 'repo' : 'dashboard')}>
          <GitHub />
          {project ? 'Reconnect GitHub' : 'Connect GitHub'}
        </button>
      </Footer>
    </>
  );
}
