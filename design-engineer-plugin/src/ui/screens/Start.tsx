// Flow A: restoring, Google sign-in (the only sign-in), waiting for Google.

import React from 'react';
import { BackHeader, Body, Footer, InfoBanner, Messages, WaitRow } from '../components/Chrome';
import { External, Google, Mark } from '../components/Icons';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

export function Restoring() {
  return (
    <div className="splash" role="status">
      <div>
        <Mark size={52} />
        <h3>Design Engineer</h3>
        <p>Opening your projects…</p>
        <div className="pulse" aria-hidden="true"><i /><i /><i /></div>
      </div>
    </div>
  );
}

export function SignIn({ state, actions }: Props) {
  const ended = !!state.route.params?.ended;
  const projectName = state.route.params?.projectName as string | null | undefined;
  return (
    <>
      <Body>
        <div className="signin-hero">
          <Mark size={44} />
          {ended ? (
            <>
              <h3>Sign in again to continue</h3>
              <InfoBanner>
                Your session ended. Sign in with the same Google account
                {projectName ? <> and you'll return to <b>{projectName}</b>.</> : ' to pick up where you left off.'}
              </InfoBanner>
            </>
          ) : (
            <>
              <h3>Turn Figma screens into a pull request</h3>
              <p className="lede flush">
                Select screens, link your repo and pick an AI model. Design Engineer builds the screens and opens a pull
                request for you to review.
              </p>
              <div className="flowline"><b>Select screens</b>→<b>Plan</b>→<b>Build</b>→<b>Pull request</b></div>
            </>
          )}
          <Messages error={state.error} notice={state.notice} onDismiss={actions.dismissError} />
        </div>
      </Body>
      <Footer>
        <button type="button" className="btn btn-google" onClick={() => void actions.signInWithGoogle()}>
          <Google className="g" />
          Continue with Google
        </button>
        {!ended && <div className="legal">Use the Google account you want your projects saved to.</div>}
      </Footer>
    </>
  );
}

export function GoogleWait({ actions }: Props) {
  return (
    <>
      <BackHeader onBack={actions.cancelGoogle} showLabel />
      <Body>
        <h3>Finish signing in with Google</h3>
        <p className="lede">Choose your account in the browser tab we opened. This screen moves on by itself.</p>
        <div className="grow" />
        <WaitRow label="Waiting for Google" detail="Times out after 10 min" />
      </Body>
      <Footer>
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={actions.cancelGoogle}>Cancel</button>
          <button type="button" className="btn btn-ghost" onClick={actions.reopenGoogle}>
            <External />
            Reopen Google
          </button>
        </div>
      </Footer>
    </>
  );
}
