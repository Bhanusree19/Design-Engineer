import React from 'react';

export interface ContextChipProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
}

export default function ContextChip({ label, checked, onToggle }: ContextChipProps) {
  return (
    <button
      type="button"
      className={`chip ${checked ? 'chip-active' : ''}`}
      onClick={onToggle}
      title={checked ? 'Selected — click to remove' : 'Click to include in fetch'}
    >
      {label} {checked ? '×' : '+'}
    </button>
  );
}
