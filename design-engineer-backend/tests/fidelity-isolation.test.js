'use strict';
// Regression: in the Cloudflare container (root + AGENT_OS_ISOLATION=1) the
// fidelity scratch folder was created root-only, npm install failed with
// EACCES, and builds finished without a preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const app = require('../services/fidelity/app');

const isRootLinux = process.platform === 'linux' && process.getuid && process.getuid() === 0;

test('isolated agent user can install and build in the fidelity scratch folder', { skip: !isRootLinux && 'needs root on Linux' }, async () => {
  const previous = process.env.AGENT_OS_ISOLATION;
  process.env.AGENT_OS_ISOLATION = '1';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'design-engineer-'));
  try {
    fs.chmodSync(tempRoot, 0o711); // as left by the coding-agent step
    const worktree = path.join(tempRoot, 'repository');
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, 'package.json'), JSON.stringify({
      name: 'fixture', version: '1.0.0',
      scripts: { build: "node -e \"require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/index.html','<h1>ok</h1>')\"" },
    }));
    const built = await app.prepareStaticApp({ worktree, scratch: path.join(tempRoot, 'fidelity-0', 'fidelity'), manifest: null });
    assert.ok(fs.existsSync(path.join(built.root, 'index.html')));
    const mode = (p) => fs.statSync(p).mode & 0o777;
    assert.equal(mode(path.join(tempRoot, 'fidelity-0')), 0o711);
    assert.equal(mode(path.join(tempRoot, 'fidelity-0', 'fidelity', 'home')), 0o700);
  } finally {
    if (previous === undefined) delete process.env.AGENT_OS_ISOLATION; else process.env.AGENT_OS_ISOLATION = previous;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
