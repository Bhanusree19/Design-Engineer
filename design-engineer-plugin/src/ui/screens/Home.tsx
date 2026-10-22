// Projects home: connection tiles, project list, account sheet.

import React, { useEffect, useState } from 'react';
import { AppHeader, Body, ErrorBanner, Footer, Sheet, WaitRow } from '../components/Chrome';
import { Codex, GitHub, LogOut, More, Plus, Refresh, Swap } from '../components/Icons';
import CodexSheet from './CodexSheet';
import { stackLabel } from '../hooks/useDesignEngineer';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';
import type { Project } from '../../api/client';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

export default function Home({ state, actions }: Props) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);

  const codexOpen = state.waiting === 'codex' || !!state.codexDevice;
  const projects = state.projects;

  // Close the project menu on any outside click.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuFor]);

  return (
    <>
      <AppHeader email={state.userEmail} onAvatar={() => setAccountOpen(true)} avatarOpen={accountOpen} />
      <Body>
        <div className="conns">
          <ConnectionTile
            label="GitHub"
            value={state.github.connected ? `@${state.github.githubUser}` : null}
            onClick={() => (state.github.connected ? setAccountOpen(true) : actions.connectGithub('dashboard'))}
          />
          <ConnectionTile
            label="Codex"
            value={state.codex.connected ? state.codex.codexUser || 'Connected' : null}
            onClick={() => (state.codex.connected ? setAccountOpen(true) : actions.connectCodex())}
          />
        </div>

        {state.error && <ErrorBanner message={state.error} />}

        {state.waiting === 'dashboard' && projects.length === 0 ? (
          <WaitRow label="Loading your projects" />
        ) : projects.length === 0 && state.error ? null : projects.length === 0 ? (
          <div className="empty">
            <div>
              <div className="stackart" aria-hidden="true"><i /><i /><i /></div>
              <h2>Start your first project</h2>
              <p>A project links your Figma screens to one GitHub repo, branch and stack.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="sec">
              <h2>Projects</h2>
              <button className="link small" type="button" onClick={actions.newProject}>+ New project</button>
            </div>
            <div className="plist scroll">
              {projects.map((project) =>
                confirmFor === project.id ? (
                  <div className="prow confirm" key={project.id} role="alertdialog" aria-label={`Delete ${project.name}`}>
                    <p><b>Delete {project.name}?</b> Its saved screens are removed too. The GitHub repo isn't touched.</p>
                    <div className="acts">
                      <button className="btn btn-ghost btn-sm" type="button" autoFocus onClick={() => setConfirmFor(null)}>Keep</button>
                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        onClick={() => {
                          setConfirmFor(null);
                          actions.deleteProject(project.id);
                        }}
                      >
                        Delete project
                      </button>
                    </div>
                  </div>
                ) : (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    menuOpen={menuFor === project.id}
                    onOpen={() => actions.openProject(project)}
                    onMenu={() => setMenuFor(menuFor === project.id ? null : project.id)}
                    onChangeSetup={() => actions.changeSetupFor(project)}
                    onDelete={() => setConfirmFor(project.id)}
                  />
                )
              )}
            </div>
          </>
        )}
      </Body>
      {projects.length === 0 && state.waiting !== 'dashboard' && (
        <Footer>
          {state.error ? (
            <button className="btn btn-primary" type="button" onClick={actions.retry}>
              <Refresh />
              Try again
            </button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={actions.newProject}>
              <Plus />
              New project
            </button>
          )}
        </Footer>
      )}

      {accountOpen && !codexOpen && <AccountSheet state={state} actions={actions} onClose={() => setAccountOpen(false)} />}
      {codexOpen && <CodexSheet state={state} actions={actions} title="Connect Codex" />}
    </>
  );
}

function ConnectionTile({ label, value, onClick }: { label: string; value: string | null; onClick: () => void }) {
  return (
    <button type="button" className={`conn ${value ? '' : 'off'}`} onClick={onClick}>
      <span className="k"><span className="st-dot" />{label}</span>
      <span className="v">{value || 'Connect'}</span>
    </button>
  );
}

function ProjectRow({
  project,
  menuOpen,
  onOpen,
  onMenu,
  onChangeSetup,
  onDelete,
}: {
  project: Project;
  menuOpen: boolean;
  onOpen: () => void;
  onMenu: () => void;
  onChangeSetup: () => void;
  onDelete: () => void;
}) {
  const where = project.repository
    ? `${project.repository}${project.base_branch ? ` · ${project.base_branch}` : ''}`
    : null;

  return (
    <div className="prow">
      <button type="button" className="prow-main" onClick={onOpen}>
        <span className="pic" aria-hidden="true">{project.name.trim().charAt(0).toUpperCase() || '?'}</span>
        <span className="tx">
          <b>{project.name}</b>
          {where ? <span>{where}</span> : <span className="none">Repo not chosen yet</span>}
        </span>
        {project.stack && <span className="tag">{stackLabel(project.stack)}</span>}
      </button>
      <div className="kebab-wrap">
        <button
          type="button"
          className={`kebab ${menuOpen ? 'on' : ''}`}
          aria-label={`More for ${project.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            onMenu();
          }}
        >
          <More className="ico" />
        </button>
        {menuOpen && (
          <div className="menu" role="menu">
            <button type="button" role="menuitem" onClick={onChangeSetup}>Change repo or stack</button>
            <button type="button" role="menuitem" className="danger" onClick={onDelete}>Delete project</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AccountSheet({ state, actions, onClose }: Props & { onClose: () => void }) {
  const loggingOut = state.waiting === 'logout';
  const initial = (state.userEmail || '?').charAt(0).toUpperCase();

  return (
    <Sheet onClose={onClose} label="Account and connections">
      <div className="acct">
        <span className="avatar static" aria-hidden="true">{initial}</span>
        <span className="tx"><b>{state.userEmail}</b><span>Your Design Engineer account</span></span>
      </div>
      <div className="lrows">
        <div className="lrow">
          <GitHub className="ico" />
          <span className="tx">
            <b>GitHub</b>
            <span>{state.github.connected ? `Connected as @${state.github.githubUser}` : 'Not connected'}</span>
          </span>
          <span className="acts">
            {state.github.connected ? (
              <>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => { onClose(); actions.switchGithubAccount(); }}>Switch</button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={actions.disconnectGithub}>Disconnect</button>
              </>
            ) : (
              <button className="btn btn-primary btn-sm" type="button" onClick={() => { onClose(); actions.connectGithub('dashboard'); }}>Connect</button>
            )}
          </span>
        </div>
        <div className="lrow">
          <Codex className="ico" />
          <span className="tx">
            <b>Codex</b>
            <span>{state.codex.connected ? `Connected as ${state.codex.codexUser || 'Codex user'}` : 'Not connected'}</span>
          </span>
          <span className="acts">
            {state.codex.connected ? (
              <button className="btn btn-ghost btn-sm" type="button" onClick={actions.switchCodexAccount}>Switch</button>
            ) : (
              <button className="btn btn-primary btn-sm" type="button" onClick={actions.connectCodex}>Connect</button>
            )}
          </span>
        </div>
        <button type="button" className="lrow lbtn" onClick={actions.useAnotherAccount}>
          <Swap className="ico" />
          <span className="tx"><b>Use another account</b><span>Sign out here and sign in as someone else</span></span>
        </button>
        <button type="button" className="lrow lbtn danger" onClick={actions.logOut} disabled={loggingOut}>
          <LogOut className="ico" />
          <span className="tx"><b>{loggingOut ? 'Logging out…' : 'Log out'}</b><span>Ends your Design Engineer session</span></span>
        </button>
      </div>
    </Sheet>
  );
}
