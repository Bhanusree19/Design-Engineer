import React from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, SuccessBanner, WaitRow, Who } from '../components/Chrome';
import { External, Lock, Shield } from '../components/Icons';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

export default function Github({ state, actions }: Props) {
  const header = <Header>{state.codexUser && <Who name={state.codexUser} />}</Header>;

  if (state.waiting === 'github') {
    return (
      <>
        {header}
        <Rail step="github" />
        <Body>
          <h1>Finish in your browser</h1>
          <p className="lede">Authorize Design Engineer on GitHub, then come back here. This screen moves on by itself.</p>
          <div className="grow" />
          <WaitRow label="Waiting for GitHub" />
        </Body>
        <Footer>
          <div className="btn-row">
            <button className="btn btn-ghost" type="button" onClick={actions.cancelWaiting}>Cancel</button>
            <button className="btn btn-ghost" type="button" onClick={actions.reopenGithub}>
              <External />
              Reopen GitHub
            </button>
          </div>
        </Footer>
      </>
    );
  }

  return (
    <>
      {header}
      <Rail step="github" />
      <Body>
        {state.codexUser ? (
          <SuccessBanner>Signed in to Codex as <b>{state.codexUser}</b></SuccessBanner>
        ) : (
          <SuccessBanner>Signed in to Codex</SuccessBanner>
        )}
        <h1>Connect GitHub</h1>
        {state.error && <ErrorBanner message={state.error} />}
        <p className="lede">Choose which repository your screens belong to. Design Context is saved against that repo and branch.</p>
        <div className="points">
          <div><Shield className="ico" /><span>Your GitHub token stays on the Design Engineer server. The plugin never sees it.</span></div>
          <div><Lock className="ico" /><span>Private repos show up if you grant access.</span></div>
        </div>
      </Body>
      <Footer hint="Opens github.com in your browser">
        <button className="btn btn-primary" type="button" onClick={actions.connectGithub}>Continue with GitHub</button>
      </Footer>
    </>
  );
}
