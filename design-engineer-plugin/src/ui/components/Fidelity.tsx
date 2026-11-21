// Design fidelity card on the build result: the overall score, one bar per
// layer, and each screen with its heatmap and the problems the check found.

import React, { useState } from 'react';
import type { FidelityGrade, FidelityLayer, FidelityResult, FidelityScreen } from '../../api/client';
import { ChevronDown } from './Icons';

const LAYERS: { key: FidelityLayer; label: string; hint: string }[] = [
  { key: 'geometry', label: 'Layout', hint: 'Every Figma layer in the right place at the right size' },
  { key: 'visual', label: 'Visual', hint: 'The rendered screen compared with the Figma export' },
  { key: 'style', label: 'Styles', hint: 'Colours, fonts, sizes, line height, radius, borders' },
  { key: 'interaction', label: 'Prototype', hint: 'Prototype links click through to the right screen' },
  { key: 'motion', label: 'Motion', hint: 'Transition duration and easing match Figma' },
  { key: 'responsive', label: 'Responsive', hint: 'Layout holds at other widths' },
];

export const GRADE_LABEL: Record<FidelityGrade, string> = {
  exact: 'Exact match',
  close: 'Close',
  'needs-work': 'Needs work',
  off: 'Off',
};

export function gradeTone(grade: FidelityGrade | undefined): 'ok' | 'warn' | 'bad' {
  return grade === 'exact' || grade === 'close' ? 'ok' : grade === 'needs-work' ? 'warn' : 'bad';
}

function toneFor(v: number) {
  return v >= 85 ? 'ok' : v >= 70 ? 'warn' : 'bad';
}

function Score({ value, grade }: { value: number; grade?: FidelityGrade }) {
  const shown = Math.round(value);
  return (
    <span className={`fid-score ${gradeTone(grade)}`} aria-label={`Fidelity ${shown} out of 100`}>
      <b>{shown}</b>
      <small>/100</small>
    </span>
  );
}

function ScreenRow({ s }: { s: FidelityScreen }) {
  const [open, setOpen] = useState(false);
  const measured = s.status === 'measured';
  const more = s.issueCount - s.issues.length;
  return (
    <div className={`fid-screen ${open ? 'open' : ''}`}>
      <button type="button" className="fid-screen-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        {s.heatmapPng
          ? <img className="fid-heat" src={`data:image/png;base64,${s.heatmapPng}`} alt="" />
          : <span className="fid-heat none" aria-hidden="true" />}
        <span className="tx">
          <b>{s.name}</b>
          <span>
            {measured
              ? `${s.matched}/${s.total} layers found · ${s.issueCount ? `${s.issueCount} issue${s.issueCount === 1 ? '' : 's'}` : 'no issues'}`
              : s.status === 'no-route' ? "Couldn't open this screen" : 'Not checked: time ran out'}
          </span>
        </span>
        {measured && <span className={`tag ${toneFor(s.score)}`}>{Math.round(s.score)}</span>}
        <ChevronDown className="ico chev" />
      </button>
      {open && (
        <div className="fid-issues">
          {s.issues.length === 0 ? (
            <p className="muted">Nothing to fix on this screen.</p>
          ) : (
            <ul>
              {s.issues.map((i, n) => (
                <li key={n}><span className={`fid-kind k-${i.kind}`}>{kindLabel(i.kind)}</span>{i.message}</li>
              ))}
            </ul>
          )}
          {more > 0 && <p className="muted">{more} smaller issue{more === 1 ? '' : 's'} listed in the pull request.</p>}
          {s.heatmapPng && <p className="muted">Red areas on the thumbnail differ from the Figma export.</p>}
        </div>
      )}
    </div>
  );
}

function kindLabel(kind: string) {
  switch (kind) {
    case 'missing': return 'Missing';
    case 'geometry': return 'Layout';
    case 'style': return 'Style';
    case 'content': return 'Text';
    case 'visual': return 'Visual';
    case 'interaction': return 'Prototype';
    case 'motion': return 'Motion';
    case 'responsive': return 'Resize';
    default: return 'Error';
  }
}

export function FidelityCard({ fidelity }: { fidelity: FidelityResult | null }) {
  if (!fidelity) return null;
  if (fidelity.status !== 'measured' || fidelity.score == null) {
    return (
      <div className="fid fid-off" role="note">
        <b>Design fidelity not measured</b>
        <span>{fidelity.reason ? `${fidelity.reason.charAt(0).toUpperCase()}${fidelity.reason.slice(1)}.` : 'The check could not run for this build.'} The pull request is unaffected.</span>
      </div>
    );
  }
  const rounds = fidelity.rounds || [];
  const fixed = rounds.length > 1;
  const it = fidelity.interactions;
  return (
    <section className="fid" aria-label="Design fidelity">
      <div className="fid-top">
        <Score value={fidelity.score} grade={fidelity.grade} />
        <span className="tx">
          <b>Design fidelity · {fidelity.grade ? GRADE_LABEL[fidelity.grade] : ''}</b>
          <span>
            {fixed ? `First pass ${Math.round(rounds[0].score)}, fixed to ${Math.round(fidelity.score)}` : 'Measured in Chromium against your Figma file'}
            {fidelity.target ? ` · target ${fidelity.target}` : ''}
          </span>
        </span>
      </div>
      <dl className="fid-layers">
        {LAYERS.map(({ key, label, hint }) => {
          const v = fidelity.layers?.[key];
          return (
            <div key={key} title={hint}>
              <dt>{label}</dt>
              <dd>
                <span className="fid-bar" aria-hidden="true"><i className={v == null ? '' : toneFor(v)} style={{ width: `${v ?? 0}%` }} /></span>
                <span className="fid-v">{v == null ? '—' : v}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      {it && it.total > 0 && (
        <p className="fid-note">Prototype links: {it.passed} worked{it.failed ? `, ${it.failed} didn't` : ''}{it.skipped ? `, ${it.skipped} not checked` : ''}.</p>
      )}
      {(fidelity.screens || []).length > 0 && (
        <div className="fid-screens">
          {(fidelity.screens || []).map((s) => <ScreenRow key={s.name} s={s} />)}
        </div>
      )}
      {(fidelity.warnings || []).map((w) => <p className="fid-note warn" key={w}>{w}</p>)}
    </section>
  );
}
