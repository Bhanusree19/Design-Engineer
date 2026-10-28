import React, { FormEvent, useState } from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, SuccessBanner } from '../components/Chrome';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

export default function Account({ state, actions }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const busy = state.waiting === 'account';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'signin') actions.signInWithEmail(email, password);
    else actions.signUpWithEmail(email, password);
  }

  return (
    <>
      <Header state={state} actions={actions} />
      <Rail step="account" />
      <Body>
        <h1>{mode === 'signin' ? 'Sign in to Design Engineer' : 'Create your account'}</h1>
        {state.error && <ErrorBanner message={state.error} />}
        {state.notice && <SuccessBanner>{state.notice}</SuccessBanner>}
        <p className="lede">Sign in first to securely save your Codex and GitHub connections.</p>

        <button className="btn btn-ghost" type="button" onClick={actions.connectGoogle} disabled={busy}>
          {busy ? 'Waiting for sign-in…' : 'Continue with Google'}
        </button>

        <div className="auth-divider"><span>or use email</span></div>

        <form id="account-form" className="auth-form" onSubmit={submit}>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 8 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
        </form>

        <button
          className="link"
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setPassword('');
          }}
        >
          {mode === 'signin' ? 'Create an account' : 'I already have an account'}
        </button>
      </Body>
      <Footer>
        <button className="btn btn-primary" type="submit" form="account-form" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </Footer>
    </>
  );
}
