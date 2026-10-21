import React from 'react';
import { Mark } from '../components/Icons';

export default function Restoring() {
  return (
    <div className="splash" role="status">
      <div>
        <Mark size={52} />
        <h1>Design Engineer</h1>
        <p>Checking your Codex sign-in…</p>
        <div className="pulse" aria-hidden="true"><i /><i /><i /></div>
      </div>
    </div>
  );
}
