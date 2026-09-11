import React from 'react';

export interface MessageProps {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export default function Message({ role, text }: MessageProps) {
  const label = role === 'user' ? 'You' : role === 'assistant' ? 'Codex' : '';
  return (
    <div className={`message message-${role}`}>
      {label && <div className="message-label">{label}</div>}
      <div className="message-text">{text}</div>
    </div>
  );
}
