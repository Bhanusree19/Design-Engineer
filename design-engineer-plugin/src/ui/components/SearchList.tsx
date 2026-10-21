// A searchable single-choice list, used for repositories and branches.

import React, { useMemo, useState } from 'react';
import { Search } from './Icons';

export interface SearchListItem {
  id: string;
  render: React.ReactNode;
  searchText: string;
}

interface SearchListProps {
  id: string;
  items: SearchListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onConfirm: (id: string) => void;
  placeholder: string;
  countLabel: (shown: number, total: number) => string;
  emptyLabel: string;
}

export default function SearchList({
  id,
  items,
  selectedId,
  onSelect,
  onConfirm,
  placeholder,
  countLabel,
  emptyLabel,
}: SearchListProps) {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.searchText.toLowerCase().includes(q));
  }, [items, query]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (shown.length === 0) return;
    const index = shown.findIndex((item) => item.id === selectedId);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onSelect(shown[Math.min(index + 1, shown.length - 1)].id);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onSelect(shown[Math.max(index - 1, 0)].id);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onConfirm(index >= 0 ? shown[index].id : shown[0].id);
    }
  }

  return (
    <>
      <label className="search" htmlFor={id}>
        <Search className="ico" />
        <input
          id={id}
          value={query}
          placeholder={placeholder}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>

      <div className="listhead">
        <span>{countLabel(shown.length, items.length)}</span>
      </div>

      <div className="list" role="listbox" aria-label={placeholder}>
        {shown.length === 0 && <div className="list-empty">{emptyLabel}</div>}
        {shown.map((item) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={item.id === selectedId}
            className={`item ${item.id === selectedId ? 'sel' : ''}`}
            onClick={() => onSelect(item.id)}
            onDoubleClick={() => onConfirm(item.id)}
          >
            {item.render}
          </button>
        ))}
      </div>
    </>
  );
}
