import React from 'react';
import { Mark } from '../components/Icons';

export default function Restoring() {
  return (
    <div className="splash" role="status">
      <div>
        <Mark size={52} />
        <h1>Designova AI</h1>
        <p>Loading Designova AI…</p>
        <div className="pulse" aria-hidden="true"><i /><i /><i /></div>
      </div>
    </div>
  );
}
