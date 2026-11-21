// src/ui/App.tsx
//
// Renders the screen for the route on top of the navigation stack. All
// behaviour lives in useDesignEngineer; screens only render state and call actions.

import React, { ErrorInfo } from 'react';

import { useDesignEngineer } from './hooks/useDesignEngineer';
import { GoogleWait, Restoring, SignIn } from './screens/Start';
import { Billing, Home, NewProject } from './screens/Home';
import { ProjectPage } from './screens/Project';
import { LinkBranch, LinkGithub, LinkReading, LinkRepo, LinkStack } from './screens/Link';
import { ModelAgents, ModelConnect } from './screens/Model';
import { Plan, Result, Running, SelectScreens } from './screens/Build';

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
            <h3>Something went wrong</h3>
            <p className="lede">The plugin couldn't show the next screen. Close and reopen the plugin to continue. Running builds keep going.</p>
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
  const name = state.route.name;

  return (
    <div className="app" data-route={name}>
      {name === 'restoring' && <Restoring />}
      {name === 'signin' && <SignIn {...props} />}
      {name === 'google' && <GoogleWait {...props} />}
      {name === 'home' && <Home {...props} />}
      {name === 'new-project' && <NewProject {...props} />}
      {name === 'billing' && <Billing {...props} />}
      {name === 'project' && <ProjectPage {...props} />}
      {name === 'link-github' && <LinkGithub {...props} />}
      {name === 'link-repo' && <LinkRepo {...props} />}
      {name === 'link-branch' && <LinkBranch {...props} />}
      {name === 'link-reading' && <LinkReading {...props} />}
      {name === 'link-stack' && <LinkStack {...props} />}
      {name === 'model' && <ModelAgents {...props} />}
      {name === 'model-connect' && <ModelConnect {...props} />}
      {name === 'screens' && <SelectScreens {...props} />}
      {name === 'plan' && <Plan {...props} />}
      {name === 'running' && <Running {...props} />}
      {name === 'result' && <Result {...props} />}
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
