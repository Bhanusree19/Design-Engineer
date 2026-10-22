import React, { useState } from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, WaitRow } from '../components/Chrome';
import { Check, Copy, External } from '../components/Icons';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

export default function SignIn({ state, actions }: Props) {
  if (state.deviceCode) return <DeviceCodeScreen state={state} actions={actions} />;

  const starting = state.waiting === 'codex';

  return (
    <>
      <Header />
      <Rail step="signin" />
      <Body>
        <h1>Sign in to Codex</h1>
        {state.error && <ErrorBanner message={state.error} />}
        <p className="lede">
          Codex turns the screens you select into Design Context for your repo. You only sign in once. The plugin remembers it.
        </p>
        <div className="points">
          <div><Check className="ico" /><span>Sign-in happens in your browser on OpenAI's page.</span></div>
          <div><Check className="ico" /><span>Next you'll connect GitHub and pick a repo and branch.</span></div>
        </div>
      </Body>
      <Footer hint="Opens your browser">
        <button className="btn btn-primary" type="button" onClick={actions.signIn} disabled={starting}>
          {starting ? 'Starting sign-in…' : state.error ? 'Get a new code' : 'Sign in to Codex'}
        </button>
      </Footer>
    </>
  );
}

function DeviceCodeScreen({ state, actions }: Props) {
  const [copied, setCopied] = useState(true); // the code is copied when the page opens
  const code = state.deviceCode!.userCode;
  const [left, right] = code.split('-');

  function copy() {
    actions.copyDeviceCode();
    setCopied(true);
  }

  return (
    <>
      <Header />
      <Rail step="signin" />
      <Body>
        <h1>Paste this code in your browser</h1>
        <p className="lede">We opened OpenAI's sign-in page and copied the code for you. Paste it there to approve this plugin.</p>

        <div className="keys" aria-label={`Device code ${code}`}>
          {left.split('').map((c, i) => <span className="key" key={`l${i}`}>{c}</span>)}
          {right !== undefined && <i aria-hidden="true" />}
          {(right || '').split('').map((c, i) => <span className="key" key={`r${i}`}>{c}</span>)}
        </div>

        <div className="btn-row">
          <button className="btn btn-ghost" type="button" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy code'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={actions.openDevicePage}>
            <External />
            Open page
          </button>
        </div>

        <div className="grow" />
        <WaitRow label="Waiting for approval" />
      </Body>
      <Footer>
        <button className="btn btn-ghost" type="button" onClick={actions.cancelWaiting}>Cancel</button>
      </Footer>
    </>
  );
}
