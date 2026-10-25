import React, { useState } from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, WaitRow, Who } from '../components/Chrome';
import type { Stack } from '../../api/client';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

const STACKS: { id: Stack; name: string; detail: string }[] = [
  { id: 'react-js', name: 'React JS', detail: 'Web application' },
  { id: 'react-native', name: 'React Native', detail: 'Mobile application' },
];

export default function StackStep({ state, actions }: Props) {
  const [selectedStack, setSelectedStack] = useState<Stack | null>(state.selectedProject?.stack || null);
  const saving = state.waiting === 'saving';

  return (
    <>
      <Header state={state} actions={actions}>
        {state.githubUser && <Who name={`@${state.githubUser}`} />}
      </Header>
      <Rail step="stack" />
      <Body>
        <h1>Choose a tech stack</h1>
        <p className="lede">Select the framework Codex should use when implementing screens for {state.selectedProject?.name}.</p>
        {state.error && <ErrorBanner message={state.error} />}
        {saving ? (
          <WaitRow label="Saving tech stack" />
        ) : (
          <div className="stack-options" role="radiogroup" aria-label="Tech stack">
            {STACKS.map((stack) => (
              <button
                key={stack.id}
                type="button"
                role="radio"
                aria-checked={selectedStack === stack.id}
                className={`stack-option ${selectedStack === stack.id ? 'selected' : ''}`}
                onClick={() => setSelectedStack(stack.id)}
              >
                <span className="stack-radio" aria-hidden="true" />
                <span>
                  <b>{stack.name}</b>
                  <small>{stack.detail}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </Body>
      <Footer>
        <button className="btn btn-ghost" type="button" onClick={actions.goBack} disabled={saving}>Back to screens</button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!selectedStack || saving}
          onClick={() => selectedStack && void actions.chooseStack(selectedStack)}
        >
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </Footer>
    </>
  );
}
