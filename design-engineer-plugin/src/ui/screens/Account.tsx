// Welcome, create account, sign in, and waiting for Google.

import React, { useState } from 'react';
import { BackHeader, Body, ErrorBanner, Footer, InfoBanner, WaitRow } from '../components/Chrome';
import { External, Eye, EyeOff, Google, Mark } from '../components/Icons';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

function GoogleButton({ actions, disabled }: { actions: DesignEngineerActions; disabled: boolean }) {
  return (
    <button className="btn btn-google" type="button" onClick={actions.continueWithGoogle} disabled={disabled}>
      <Google />
      Continue with Google
    </button>
  );
}

// -----------------------------------------------------------------------------
// WELCOME
// -----------------------------------------------------------------------------

export function Welcome({ state, actions }: Props) {
  const busy = state.waiting === 'google';
  return (
    <>
      <Body>
        <div className="welcome">
          <Mark size={44} />
          <h1>Turn Figma screens into a pull request</h1>
          <p className="lede flat">Pick screens on the canvas. Codex builds them in your repo and opens a PR for you to review.</p>
          <div className="flowline" aria-hidden="true">
            <b>Select screens</b>→<b>Plan</b>→<b>Implement</b>→<b>Pull request</b>
          </div>
        </div>
        {state.notice && <InfoBanner>{state.notice}</InfoBanner>}
        {state.error && <ErrorBanner message={state.error} />}
      </Body>
      <Footer>
        <GoogleButton actions={actions} disabled={busy} />
        <div className="or">or</div>
        <div className="btn-row">
          <button className="btn btn-ghost" type="button" onClick={() => actions.go('signin')}>Sign in</button>
          <button className="btn btn-primary" type="button" onClick={() => actions.go('signup')}>Create account</button>
        </div>
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// FIELDS
// -----------------------------------------------------------------------------

function Field({
  id,
  label,
  aside,
  error,
  children,
}: {
  id: string;
  label: string;
  aside?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {aside && <span>{aside}</span>}
      </label>
      {children}
      {error && <div className="err" id={`${id}-err`}>{error}</div>}
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  onEnter,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  onEnter?: () => void;
  autoComplete: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className={`input ${invalid ? 'bad' : ''}`}>
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter();
        }}
      />
      <button type="button" className="eye" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide password' : 'Show password'}>
        {shown ? <EyeOff className="ico" /> : <Eye className="ico" />}
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// CREATE ACCOUNT
// -----------------------------------------------------------------------------

export function SignUp({ state, actions }: Props) {
  const [email, setEmail] = useState(state.prefillEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const busy = state.waiting === 'auth' || state.waiting === 'dashboard';
  const fe = state.fieldErrors;
  const submit = () => actions.signUp(email, password, confirm);

  return (
    <>
      <BackHeader onBack={() => actions.go('auth')} />
      <Body className="scroll-y">
        <h1>Create your account</h1>
        {state.error && <ErrorBanner message={state.error} />}
        <GoogleButton actions={actions} disabled={busy} />
        <div className="or">or use email</div>
        <Field id="su-email" label="Email" error={fe.email}>
          <div className={`input ${fe.email ? 'bad' : ''}`}>
            <input id="su-email" type="email" value={email} placeholder="you@example.com" autoComplete="email" autoFocus aria-invalid={!!fe.email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </Field>
        <Field id="su-password" label="Password" aside="At least 8 characters" error={fe.password}>
          <PasswordInput id="su-password" value={password} onChange={setPassword} invalid={!!fe.password} autoComplete="new-password" />
        </Field>
        <Field id="su-confirm" label="Confirm password" error={fe.confirm}>
          <PasswordInput id="su-confirm" value={confirm} onChange={setConfirm} invalid={!!fe.confirm} onEnter={submit} autoComplete="new-password" />
        </Field>
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        <div className="switch-line">
          Already have an account? <button className="link" type="button" onClick={() => actions.go('signin')}>Sign in</button>
        </div>
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// SIGN IN
// -----------------------------------------------------------------------------

export function SignIn({ state, actions }: Props) {
  const [email, setEmail] = useState(state.prefillEmail);
  const [password, setPassword] = useState('');
  const busy = state.waiting === 'auth' || state.waiting === 'dashboard';
  const fe = state.fieldErrors;
  const submit = () => actions.signIn(email, password);

  return (
    <>
      <BackHeader onBack={() => actions.go('auth')} />
      <Body className="scroll-y">
        <h1>Sign in</h1>
        {state.notice && (
          <InfoBanner>
            <b>Confirm your email.</b> {state.notice}
          </InfoBanner>
        )}
        {state.error && <ErrorBanner message={state.error} />}
        <GoogleButton actions={actions} disabled={busy} />
        <div className="or">or use email</div>
        <Field id="si-email" label="Email" error={fe.email}>
          <div className={`input ${fe.email ? 'bad' : ''}`}>
            <input id="si-email" type="email" value={email} placeholder="you@example.com" autoComplete="email" autoFocus={!email} aria-invalid={!!fe.email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </Field>
        <Field id="si-password" label="Password" error={fe.password}>
          <PasswordInput id="si-password" value={password} onChange={setPassword} placeholder="Your password" invalid={!!fe.password} onEnter={submit} autoComplete="current-password" />
        </Field>
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="switch-line">
          New here? <button className="link" type="button" onClick={() => actions.go('signup')}>Create an account</button>
        </div>
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// GOOGLE
// -----------------------------------------------------------------------------

export function GoogleWait({ state, actions }: Props) {
  const finishing = state.waiting === 'dashboard';
  return (
    <>
      <BackHeader onBack={actions.cancelGoogle} />
      <Body>
        <h1>Finish signing in with Google</h1>
        <p className="lede">Choose your Google account in the browser tab we opened. This screen moves on by itself.</p>
        <div className="grow" />
        <WaitRow label={finishing ? 'Loading your projects' : 'Waiting for Google'} detail={finishing ? undefined : 'Times out after 10 min'} />
      </Body>
      <Footer>
        <div className="btn-row">
          <button className="btn btn-ghost" type="button" onClick={actions.cancelGoogle}>Cancel</button>
          <button className="btn btn-ghost" type="button" onClick={actions.reopenGoogle}>
            <External />
            Reopen Google
          </button>
        </div>
      </Footer>
    </>
  );
}
