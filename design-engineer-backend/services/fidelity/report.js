'use strict';
// Turns a fidelity report into: the compact JSON stored on the job (shown in
// the plugin), the pull request section, and the repair prompt for the agent.

const LAYER_LABELS = { geometry: 'Layout', visual: 'Visual', style: 'Styles', interaction: 'Prototype', motion: 'Motion', responsive: 'Responsive' };
const GRADE_LABELS = { exact: 'Exact match', close: 'Close', 'needs-work': 'Needs work', off: 'Off' };

/** Compact, bounded copy for implementation_jobs.result.fidelity. */
function forJob(report, { target, rounds = [] } = {}) {
  if (!report || report.status !== 'measured') {
    return { status: report?.status || 'unavailable', reason: report?.reason || null, target, rounds };
  }
  return {
    status: 'measured',
    score: report.score,
    grade: report.grade,
    target,
    rounds,
    layers: report.layers,
    coverage: report.coverage,
    screens: report.screens.slice(0, 12).map((s, i) => ({
      name: s.name, route: s.route, status: s.status, score: s.score, layers: s.layers, coverage: s.coverage,
      matched: s.matched, total: s.total, ssim: s.ssim, pixelMatch: s.pixelMatch,
      heatmapPng: i < 6 ? s.heatmapPng : null,
      issues: s.issues.slice(0, 8).map((x) => ({ kind: x.kind, nodeId: x.nodeId || null, message: x.message })),
      issueCount: s.issues.length,
    })),
    interactions: {
      total: report.interactions.length,
      passed: report.interactions.filter((i) => i.status === 'pass').length,
      failed: report.interactions.filter((i) => i.status === 'fail').length,
      skipped: report.interactions.filter((i) => i.status === 'skipped').length,
    },
    warnings: report.warnings.slice(0, 6),
    durationMs: report.durationMs,
  };
}

function bar(v) {
  if (v == null) return '—';
  return `${v}%`;
}

/** Markdown section appended to the pull request body. */
function toMarkdown(job) {
  if (!job) return '';
  if (job.status !== 'measured') {
    return `\n\n## Design fidelity\n\nNot measured: ${job.reason || 'the check could not run'}.\n`;
  }
  const lines = [];
  const improved = job.rounds && job.rounds.length > 1
    ? ` (first pass ${job.rounds[0].score}, after ${job.rounds.length - 1} fix round${job.rounds.length > 2 ? 's' : ''})` : '';
  lines.push('', '', '## Design fidelity', '');
  lines.push(`**${job.score} / 100 · ${GRADE_LABELS[job.grade] || job.grade}**${improved}. Target ${job.target}.`);
  lines.push('');
  lines.push('| ' + Object.values(LAYER_LABELS).join(' | ') + ' |');
  lines.push('|' + Object.keys(LAYER_LABELS).map(() => ' --- ').join('|') + '|');
  lines.push('| ' + Object.keys(LAYER_LABELS).map((k) => bar(job.layers[k])).join(' | ') + ' |');
  lines.push('');
  lines.push('| Screen | Score | Elements matched | Visual (SSIM) | Top issue |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const s of job.screens) {
    const top = s.issues[0]?.message ? s.issues[0].message.replace(/\|/g, '\\|').slice(0, 140) : 'None';
    lines.push(`| ${s.name.replace(/\|/g, '\\|')} | ${s.status === 'measured' ? s.score : s.status} | ${s.matched}/${s.total} | ${s.ssim ?? '—'} | ${top} |`);
  }
  const it = job.interactions;
  if (it.total) lines.push('', `Prototype interactions: ${it.passed} passed, ${it.failed} failed, ${it.skipped} not checked.`);
  if (job.warnings.length) lines.push('', ...job.warnings.map((w) => `> ${w}`));
  lines.push('', '<sub>Measured by rendering the web build in Chromium at each frame\'s size and comparing it with the Figma file node by node. Re-run anytime with the manifest in `design-engineer.fidelity.json`.</sub>');
  return lines.join('\n') + '\n';
}

/** Prompt for one repair round: the worst measured problems, concrete and bounded. */
function repairPrompt(report, { limit = 30 } = {}) {
  const issues = report.screens.flatMap((s) => s.issues).sort((a, b) => b.impact - a.impact).slice(0, limit);
  const lines = issues.map((i) => `- [${i.screen}]${i.nodeId ? ` (node ${i.nodeId})` : ''} ${i.message}`);
  return `A fidelity check rendered your implementation in a browser at each Figma frame's exact size and compared it with the design, node by node. It scored ${report.score}/100 (layout ${report.layers.geometry ?? '—'}, visual ${report.layers.visual ?? '—'}, styles ${report.layers.style ?? '—'}, prototype ${report.layers.interaction ?? '—'}, motion ${report.layers.motion ?? '—'}, responsive ${report.layers.responsive ?? '—'}).

Fix these problems, worst first. Use the design context JSON files as the source of truth. Do not change unrelated code, do not remove the data-fid / testID "fid:" tags, and keep design-engineer.fidelity.json accurate:
${lines.join('\n')}

When an element is reported as missing, render it and tag it with its Figma node ID. When a position is off, fix the layout (padding, gap, alignment, sizes) instead of nudging with absolute offsets. Run the build again before finishing.`;
}

module.exports = { forJob, toMarkdown, repairPrompt, LAYER_LABELS };
