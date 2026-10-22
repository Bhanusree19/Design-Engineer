import React from 'react';
import { Mark } from '../components/Icons';

export default function Boot() {
  return (
    <div className="splash" role="status">
      <div>
        <Mark size={52} />
        <h1>Design Engineer</h1>
        <p>Restoring your account…</p>
        <div className="pulse" aria-hidden="true"><i /><i /><i /></div>
      </div>
    </div>
  );
}
