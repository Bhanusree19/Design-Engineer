// Codex device sign-in, shown as a sheet over Projects or the plan.

import React, { useState } from 'react';
import { Sheet, Spinner } from '../components/Chrome';
import { Check, Copy, External } from '../components/Icons';
import type { DesignEngineerActions, DesignEngineerState } from '../hooks/useDesignEngineer';

type Props = { state: DesignEngineerState; actions: DesignEngineerActions; title: string };

export default function CodexSheet({ state, actions, title }: Props) {
  const [copied, setCopied] = useState(true); // the code is copied when the page opens
  const device = state.codexDevice;

  return (
    <Sheet onClose={actions.cancelCodex} label={title}>
      <h2 className="sheet-title">{title}</h2>
      {!device ? (
        <div className="wait" role="status">
          <Spinner />
          <span className="wait-label">Getting a sign-in code</span>
        </div>
      ) : (
        <>
          <p className="lede flat">We opened OpenAI's sign-in page and copied this code. Paste it there.</p>
          <CodeKeys code={device.userCode} />
          <div className="btn-row">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                actions.copyCodexCode();
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy code'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={actions.openCodexPage}>
              <External />
              Open page
            </button>
          </div>
          <div className="wait" role="status">
            <Spinner />
            <span className="wait-label">Waiting for approval</span>
            <button className="link small" type="button" onClick={actions.cancelCodex}>Cancel</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function CodeKeys({ code }: { code: string }) {
  const [left, right] = code.split('-');
  return (
    <div className="keys" aria-label={`Sign-in code ${code}`}>
      {left.split('').map((c, i) => <span className="key" key={`l${i}`}>{c}</span>)}
      {right !== undefined && <i aria-hidden="true" />}
      {(right || '').split('').map((c, i) => <span className="key" key={`r${i}`}>{c}</span>)}
    </div>
  );
}
