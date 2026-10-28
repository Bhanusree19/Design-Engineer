// src/ui/App.tsx
//
// Picks the screen for the current step. All behaviour lives in
// useDesignEngineer; the screens only render state and call actions.

import React, { ErrorInfo } from 'react';

import { useDesignEngineer } from './hooks/useDesignEngineer';
import Restoring from './screens/Restoring';
import Account from './screens/Account';
import SignIn from './screens/SignIn';
import Github from './screens/Github';
import Projects from './screens/Projects';
import { BranchStep, RepoStep } from './screens/Pickers';
import {
  Complete,
  Done,
  Implementing,
  PlanReview,
  Planning,
  ScreensStep,
} from './screens/Screens';

interface ErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Design Engineer] UI render failed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <header className="head"><span className="head-name">Design Engineer</span></header>
          <main className="body">
            <h1>Something went wrong</h1>
            <p className="lede">The plugin could not render the next screen. Reload the plugin to continue.</p>
            <pre className="runtime-error">{this.state.error.message}</pre>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}

function DesignEngineerApp() {
  const { state, actions } = useDesignEngineer();
  const props = { state, actions };

  return (
    <div className="app" data-step={state.step}>
      {state.step === 'restoring' && <Restoring />}
      {state.step === 'account' && <Account {...props} />}
      {state.step === 'signin' && <SignIn {...props} />}
      {state.step === 'github' && <Github {...props} />}
      {state.step === 'project' && <Projects {...props} />}
      {state.step === 'repo' && <RepoStep {...props} />}
      {state.step === 'branch' && <BranchStep {...props} />}
      {state.step === 'screens' && <ScreensStep {...props} />}
      {state.step === 'done' && <Done {...props} />}
      {state.step === 'planning' && <Planning {...props} />}
      {state.step === 'plan' && <PlanReview {...props} />}
      {state.step === 'implementing' && <Implementing {...props} />}
      {state.step === 'complete' && <Complete {...props} />}
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <DesignEngineerApp />
    </AppErrorBoundary>
  );
}
