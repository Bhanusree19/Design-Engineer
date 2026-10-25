import React from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, WaitRow } from '../components/Chrome';
import { Check } from '../components/Icons';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

export default function SignIn({ state, actions }: Props) {
  if (state.codexDeviceAuth) {
    return (
      <>
        <Header state={state} actions={actions} />
        <Rail step="signin" />
        <Body>
          <h1>Sign in to Codex</h1>
          <p className="lede">
            Open the OpenAI sign-in page and enter this one-time code. The plugin
            continues automatically after you approve.
          </p>
          <p className="device-code">{state.codexDeviceAuth.userCode}</p>
          <div className="grow" />
          <WaitRow label="Waiting for Codex sign-in" />
        </Body>
        <Footer>
          <button className="btn btn-ghost" type="button" onClick={actions.cancelWaiting}>Cancel</button>
          <a
            className="btn btn-primary"
            href={state.codexDeviceAuth.verificationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open sign-in page
          </a>
        </Footer>
      </>
    );
  }

  if (state.codexBrowserAuth) {
    return (
      <>
        <Header state={state} actions={actions} />
        <Rail step="signin" />
        <Body>
          <h1>Sign in to Codex in your browser</h1>
          <p className="lede">Complete the OpenAI sign-in in the browser window Codex opened. You will not need to enter a device code; this plugin continues automatically after sign-in.</p>
          <div className="grow" />
          <WaitRow label="Waiting for Codex sign-in" />
        </Body>
        <Footer>
          <button className="btn btn-ghost" type="button" onClick={actions.cancelWaiting}>Cancel</button>
        </Footer>
      </>
    );
  }

  const starting = state.waiting === 'codex';

  return (
    <>
      <Header state={state} actions={actions} />
      <Rail step="signin" />
      <Body>
        {state.codexUser ? (
          <div className="banner ok">
            <Check className="ico" />
            <p>Signed in to Codex as <b>{state.codexUser}</b></p>
          </div>
        ) : null}
        <h1>{state.codexUser ? 'Codex connected' : 'Sign in to Codex'}</h1>
        {state.error && <ErrorBanner message={state.error} />}
        <p className="lede">
          {state.codexUser
            ? 'Your Codex account is connected. Continue to GitHub or switch to another Codex account.'
            : 'Codex turns the screens you select into Design Context for your repo. You only sign in once. The plugin remembers it.'}
        </p>
        {!state.codexUser && <div className="points">
          <div><Check className="ico" /><span>Sign-in happens in your browser on OpenAI's page.</span></div>
          <div><Check className="ico" /><span>Next you'll connect GitHub and pick a repo and branch.</span></div>
        </div>}
      </Body>
      <Footer hint={state.codexUser ? undefined : 'Opens your browser'}>
        {state.codexUser ? (
          <>
            <button className="btn btn-primary" type="button" onClick={actions.switchCodexAccount} disabled={starting}>
              {starting ? 'Switching account…' : 'Switch Codex account'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={actions.continueToGithub}>Continue to GitHub</button>
          </>
        ) : (
          <button className="btn btn-primary" type="button" onClick={actions.signIn} disabled={starting}>
            {starting ? 'Opening sign-in…' : state.error ? 'Try again' : 'Sign in to Codex'}
          </button>
        )}
      </Footer>
    </>
  );
}
