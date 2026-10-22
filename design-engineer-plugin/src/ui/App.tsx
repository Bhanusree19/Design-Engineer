// src/ui/App.tsx
//
// Picks the screen for the current step. All behaviour lives in
// useDesignEngineer; the screens only render state and call actions.

import React from 'react';

import { useDesignEngineer } from './hooks/useDesignEngineer';
import Boot from './screens/Boot';
import { GoogleWait, SignIn, SignUp, Welcome } from './screens/Account';
import Home from './screens/Home';
import { GithubStep, NewProject } from './screens/NewProject';
import { BranchStep, RepoStep, StackStep } from './screens/Setup';
import { Saved, ScreensStep } from './screens/Screens';
import { Implemented, Implementing, Plan } from './screens/Build';

export default function App() {
  const { state, actions } = useDesignEngineer();
  const props = { state, actions };

  return (
    <div className="app" data-step={state.step}>
      {state.step === 'boot' && <Boot />}
      {state.step === 'auth' && <Welcome {...props} />}
      {state.step === 'signup' && <SignUp {...props} />}
      {state.step === 'signin' && <SignIn {...props} />}
      {state.step === 'google' && <GoogleWait {...props} />}
      {state.step === 'dashboard' && <Home {...props} />}
      {state.step === 'create-project' && <NewProject {...props} />}
      {state.step === 'github' && <GithubStep {...props} />}
      {state.step === 'repo' && <RepoStep {...props} />}
      {state.step === 'branch' && <BranchStep {...props} />}
      {state.step === 'stack' && <StackStep {...props} />}
      {state.step === 'screens' && <ScreensStep {...props} />}
      {state.step === 'done' && <Saved {...props} />}
      {state.step === 'plan' && <Plan {...props} />}
      {state.step === 'implementing' && <Implementing {...props} />}
      {state.step === 'implemented' && <Implemented {...props} />}
    </div>
  );
}
