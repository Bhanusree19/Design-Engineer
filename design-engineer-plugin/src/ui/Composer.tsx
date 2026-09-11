import React, { useState } from 'react';

export interface ComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function Composer({ onSend, disabled, placeholder }: ComposerProps) {
  const [value, setValue] = useState('');

  function send() {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
  }

  return (
    <div className="composer">
      <input
        value={value}
        placeholder={placeholder || (disabled ? 'Ask Codex... (coming in Phase 2)' : 'Ask Codex...')}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send();
        }}
      />
      <button disabled={disabled || !value.trim()} onClick={send}>
        ↑
      </button>
    </div>
  );
}
