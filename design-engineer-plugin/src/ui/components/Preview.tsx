// Build preview: the screens exactly as the built app renders them (captured
// by the server's check at each Figma frame's size). Everyone sees this; the
// detailed fidelity report is admin-only and shown separately.

import React, { useEffect, useState } from 'react';
import type { BuildPreview } from '../../api/client';
import { Close, Next, Prev } from './Icons';

export function PreviewGallery({ preview }: { preview: BuildPreview | null | undefined }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!preview) return null;
  const screens = preview.screens || [];
  if (!screens.length) {
    return <p className="pv-none">A preview isn't available for this build. Open the pull request to see the screens.</p>;
  }
  return (
    <section className="pv" aria-label="Preview of the built screens">
      <div className="pv-h"><b>Preview</b><span>{screens.length} screen{screens.length === 1 ? '' : 's'} as built · tap to enlarge</span></div>
      <div className="pv-row">
        {screens.map((s, i) => (
          <button type="button" className="pv-card" key={s.name} onClick={() => setOpen(i)} aria-label={`Open preview of ${s.name}`}>
            <span className="pv-img"><img src={`data:image/png;base64,${s.imagePng}`} alt="" /></span>
            <span className="pv-name">{s.name}</span>
          </button>
        ))}
      </div>
      {open != null && <Viewer screens={screens} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}

function Viewer({ screens, index, onIndex, onClose }: {
  screens: BuildPreview['screens']; index: number; onIndex: (i: number) => void; onClose: () => void;
}) {
  const s = screens[index];
  const many = screens.length > 1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < screens.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, screens.length, onClose, onIndex]);
  return (
    <div className="pv-viewer" role="dialog" aria-modal="true" aria-label={`Preview: ${s.name}`}>
      <div className="pv-bar">
        <button type="button" className="pv-btn" onClick={onClose} aria-label="Close preview"><Close /></button>
        <b>{s.name}</b>
        {many && <span className="pv-count">{index + 1} / {screens.length}</span>}
        {many && (
          <span className="pv-nav">
            <button type="button" className="pv-btn" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Previous screen"><Prev /></button>
            <button type="button" className="pv-btn" disabled={index === screens.length - 1} onClick={() => onIndex(index + 1)} aria-label="Next screen"><Next /></button>
          </span>
        )}
      </div>
      <div className="pv-stage">
        <img src={`data:image/png;base64,${s.imagePng}`} alt={`${s.name} as built`} />
      </div>
    </div>
  );
}
