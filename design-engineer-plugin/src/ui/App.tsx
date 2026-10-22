// src/ui/App.tsx
//
// Picks the screen for the current step. All behaviour lives in
// useDesignEngineer; the screens only render state and call actions.

import React from 'react';

import { useDesignEngineer } from './hooks/useDesignEngineer';
import Restoring from './screens/Restoring';
import SignIn from './screens/SignIn';
import Github from './screens/Github';
import { BranchStep, RepoStep } from './screens/Pickers';
import { Done, ScreensStep } from './screens/Screens';

export default function App() {
  const { state, actions } = useDesignEngineer();
  const props = { state, actions };

  return (
    <div className="app" data-step={state.step}>
      {state.step === 'restoring' && <Restoring />}
      {state.step === 'signin' && <SignIn {...props} />}
      {state.step === 'github' && <Github {...props} />}
      {state.step === 'repo' && <RepoStep {...props} />}
      {state.step === 'branch' && <BranchStep {...props} />}
      {state.step === 'screens' && <ScreensStep {...props} />}
      {state.step === 'done' && <Done {...props} />}
    </div>
  );
}
