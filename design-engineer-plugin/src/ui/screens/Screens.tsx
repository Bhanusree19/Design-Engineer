// Select frames from the canvas, fetch them, and see them saved.

import React from 'react';
import { Body, ErrorBanner, Footer, Rail, Spinner } from '../components/Chrome';
import { Check, Cursor } from '../components/Icons';
import { SetupHeader } from './Setup';
import type { DesignEngineerActions, DesignEngineerState, SelectionItem } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions };

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function Thumb({ item }: { item: SelectionItem }) {
  return (
    <span className={`thumb ${item.width > item.height ? 'wide' : ''}`} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

function Size({ item }: { item: SelectionItem }) {
  return <span>{Math.round(item.width)} × {Math.round(item.height)} {item.type.toLowerCase()}</span>;
}

// -----------------------------------------------------------------------------
// SELECT
// -----------------------------------------------------------------------------

export function ScreensStep({ state, actions }: Props) {
  const busy = state.waiting === 'extracting' || state.waiting === 'saving';
  if (busy) return <Fetching state={state} actions={actions} />;

  const total = state.selection.length;
  const checked = state.selection.filter((s) => state.checkedIds.has(s.id)).length;

  return (
    <>
      <SetupHeader state={state} actions={actions} />
      <Rail step="screens" />
      <Body>
        <h1>{total === 0 ? 'Select screens' : `${checked} of ${plural(total, 'screen')} selected`}</h1>
        {state.error && <ErrorBanner message={state.error} />}

        {total === 0 ? (
          <div className="empty">
            <div>
              <div className="canvas-hint" aria-hidden="true">
                <div className="fr" />
                <Cursor />
              </div>
              <p>Click a frame on the canvas, or Shift-click to select several. They'll appear here.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="listhead">
              <span>From your canvas selection</span>
              {checked === total ? (
                <button className="link small" type="button" onClick={actions.clearChecked}>Clear</button>
              ) : (
                <button className="link small" type="button" onClick={actions.checkAll}>Select all</button>
              )}
            </div>
            <div className="stack scroll">
              {state.selection.map((item) => {
                const on = state.checkedIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={`scr ${on ? 'on' : ''}`}
                    onClick={() => actions.toggleChecked(item.id)}
                  >
                    <span className="cb">{on && <Check />}</span>
                    <Thumb item={item} />
                    <span className="tx"><b>{item.name}</b><Size item={item} /></span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" disabled={checked === 0} onClick={actions.fetchScreens}>
          {checked === 0 ? 'Select screens to fetch' : `Fetch ${plural(checked, 'screen')}`}
        </button>
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// FETCHING
// -----------------------------------------------------------------------------

function Fetching({ state, actions }: Props) {
  const saving = state.waiting === 'saving';
  const items = state.fetchingItems;

  return (
    <>
      <SetupHeader state={state} actions={actions} />
      <Rail step="screens" />
      <Body>
        <h1>{saving ? 'Saving Design Context' : `Fetching ${plural(items.length, 'screen')}`}</h1>
        <div className={`bar ${saving ? 'late' : ''}`} role="progressbar" aria-label="Fetching screens"><i /></div>
        <div className="stack scroll">
          {items.map((item) => (
            <div className="scr" key={item.id}>
              <Thumb item={item} />
              <span className="tx"><b>{item.name}</b><Size item={item} /></span>
              <span className="st"><Spinner />{saving ? 'Saving' : 'Reading layers'}</span>
            </div>
          ))}
        </div>
        <div className="hint">Keep this plugin open until saving finishes.</div>
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" disabled>{saving ? 'Saving…' : 'Fetching…'}</button>
      </Footer>
    </>
  );
}

// -----------------------------------------------------------------------------
// SAVED
// -----------------------------------------------------------------------------

export function Saved({ state, actions }: Props) {
  const items = state.fetchingItems;
  const count = items.length || state.fetchedScreens.length;

  return (
    <>
      <SetupHeader state={state} actions={actions} />
      <Rail step="done" />
      <Body>
        <span className="big-ok" aria-hidden="true"><Check /></span>
        <h1>{plural(count, 'screen')} ready to build</h1>
        <p className="lede">Their Design Context is saved to this project. Next, see the plan Codex will follow. Planning writes no code.</p>
        {state.error && <ErrorBanner message={state.error} />}
        <div className="stack scroll">
          {items.map((item) => (
            <div className="scr" key={item.id}>
              <Thumb item={item} />
              <span className="tx"><b>{item.name}</b><Size item={item} /></span>
              <span className="st ok"><Check className="ico" />Saved</span>
            </div>
          ))}
        </div>
      </Body>
      <Footer>
        <button className="btn btn-primary" type="button" onClick={actions.makePlan}>Plan implementation</button>
        <button className="btn btn-ghost" type="button" onClick={actions.addMoreScreens}>Add more screens</button>
      </Footer>
    </>
  );
}
