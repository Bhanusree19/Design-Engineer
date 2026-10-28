import React, { useState } from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, WaitRow } from '../components/Chrome';
import type { Stack } from '../../api/client';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

const STACKS: { value: Stack; name: string; description: string }[] = [
  {
    value: 'react-native',
    name: 'React Native',
    description: 'Build a mobile app for iOS and Android.',
  },
  {
    value: 'react-js',
    name: 'React JS',
    description: 'Build a web app using React and Vite.',
  },
];

export default function StackStep({ state, actions }: Props) {
  const [selectedStack, setSelectedStack] = useState<Stack | null>(state.selectedProject?.stack || null);
  const saving = state.waiting === 'saving';

  return (
    <>
      <Header state={state} actions={actions} />
      <Rail step="stack" />
      <Body>
        <h1>Choose a technology stack</h1>
        {state.error && <ErrorBanner message={state.error} />}
        <p className="lede">Choose how Codex should build this project. Your choice is saved with the project.</p>
        <div className="stack-options" role="radiogroup" aria-label="Technology stack">
          {STACKS.map((stack) => {
            const selected = selectedStack === stack.value;
            return (
              <button
                key={stack.value}
                className={`stack-option ${selected ? 'selected' : ''}`}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSelectedStack(stack.value)}
                disabled={saving}
              >
                <span className="stack-radio" aria-hidden="true" />
                <span className="stack-option-copy">
                  <b>{stack.name}</b>
                  <span>{stack.description}</span>
                </span>
              </button>
            );
          })}
        </div>
        {saving && <WaitRow label="Saving technology stack" />}
      </Body>
      <Footer>
        <button className="btn btn-ghost" type="button" onClick={actions.goBack} disabled={saving}>
          Back to branch
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => selectedStack && void actions.chooseStack(selectedStack)}
          disabled={!selectedStack || saving}
        >
          {saving ? 'Saving…' : `Use ${STACKS.find((stack) => stack.value === selectedStack)?.name || 'stack'}`}
        </button>
      </Footer>
    </>
  );
}
