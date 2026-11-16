import React, { useState } from 'react';
import { Body, ErrorBanner, Footer, Header, Rail, WaitRow } from '../components/Chrome';
import RepoContextCard from '../components/RepoContextCard';
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

function stackName(stack: Stack | null | undefined) {
  return STACKS.find((s) => s.value === stack)?.name || null;
}

export default function StackStep({ state, actions }: Props) {
  const project = state.selectedProject;
  const context = project?.repo_context || null;
  const detected = context?.stack || null;
  const [selectedStack, setSelectedStack] = useState<Stack | null>(project?.stack || detected || null);
  const saving = state.waiting === 'saving';
  const conflict = !!detected && !!selectedStack && selectedStack !== detected;

  const lede = detected
    ? `This branch already has a ${stackName(detected)} app, so it is selected. Change it only if you mean to start a separate app.`
    : context?.status === 'multiple-apps'
      ? 'This branch has both a mobile and a web app. Choose which one these screens belong to.'
      : 'There is no app on this branch yet. Choose what the coding agent should create. Your choice is saved with the project.';

  return (
    <>
      <Header state={state} actions={actions} />
      <Rail step="stack" />
      <Body>
        <h1>{detected ? 'Technology stack' : 'Choose a technology stack'}</h1>
        {state.error && <ErrorBanner message={state.error} />}
        {state.notice && (
          <div className="banner info" role="status"><p>{state.notice}</p></div>
        )}
        {context && <RepoContextCard context={context} source={project?.stack_source} />}
        <p className="lede">{lede}</p>
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
                  <b>{stack.name}{detected === stack.value ? ' (found in this branch)' : ''}</b>
                  <span>{stack.description}</span>
                </span>
              </button>
            );
          })}
        </div>
        {conflict && (
          <p className="repo-warning" role="alert">
            This branch already contains a {stackName(detected)} app. Choosing {stackName(selectedStack)} makes the agent add a second app beside it.
          </p>
        )}
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
          {saving ? 'Saving…' : `Use ${stackName(selectedStack) || 'stack'}`}
        </button>
      </Footer>
    </>
  );
}
