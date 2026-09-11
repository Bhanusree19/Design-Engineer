import React, { useEffect, useRef } from 'react';
import Message from './Message';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export default function Chat({ messages }: { messages: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat">
      {messages.map((m, i) => (
        <Message key={i} role={m.role} text={m.text} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
