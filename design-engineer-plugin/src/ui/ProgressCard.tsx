import React from 'react';

export default function ProgressCard({ label }: { label: string }) {
  return (
    <div className="card progress-card">
      <div className="spinner" />
      <div>{label}</div>
    </div>
  );
}
