'use strict';
// A tiny two-screen app plus the Figma design contexts it implements, used to
// test the Fidelity Engine in a real browser. `variant: 'faithful'` follows the
// design; `variant: 'sloppy'` has the mistakes generated code typically makes.
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = { x: 1200, y: 400 }; // where the frames sit on the Figma canvas
const FONT = 'DM Sans';

function el(id, parentId, type, name, x, y, w, h, extra = {}) {
  return { id, parentId, type, name, x: ORIGIN.x + x, y: ORIGIN.y + y, width: w, height: h, ...extra };
}

const login = {
  version: '3.0', screen: 'Login', width: 390, height: 844, rootId: '1:1', origin: ORIGIN, rootColors: ['#f3f4f8'],
  page: { id: '0:1', name: 'App' }, summary: {}, extractionTimeMs: 1,
  elements: [
    el('1:2', '1:1', 'text', 'Title', 24, 96, 342, 40, { text: 'Welcome back', fontSize: 32, fontWeight: 700, fontFamily: FONT, lineHeightPx: 40, letterSpacing: 0, textAlign: 'LEFT', textAutoResize: 'HEIGHT', colors: ['#15172b'] }),
    el('1:3', '1:1', 'text', 'Subtitle', 24, 144, 342, 24, { text: 'Sign in to keep building', fontSize: 16, fontWeight: 400, fontFamily: FONT, lineHeightPx: 24, letterSpacing: 0, textAlign: 'LEFT', textAutoResize: 'HEIGHT', colors: ['#5f6480'] }),
    el('1:4', '1:1', 'rectangle', 'Email field', 24, 200, 342, 52, { colors: ['#ffffff'], radius: 10, strokeColors: ['#dde0ea'], strokeWeight: 1 }),
    el('1:5', '1:1', 'instance', 'Sign in button', 24, 720, 342, 52, { colors: ['#3346f0'], radius: 12, componentId: '9:1',
      interactions: [{ trigger: 'ON_CLICK', action: 'NAVIGATE', destinationId: '2:1', destinationName: 'Home',
        transition: { type: 'MOVE_IN', durationMs: 300, direction: 'LEFT', easing: { type: 'EASE_OUT' } } }] }),
    el('1:6', '1:5', 'text', 'Label', 168, 736, 53, 20, { text: 'Sign in', fontSize: 16, fontWeight: 600, fontFamily: FONT, lineHeightPx: 20, letterSpacing: 0, textAlign: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT', colors: ['#ffffff'] }),
  ],
};

const home = {
  version: '3.0', screen: 'Home', width: 390, height: 844, rootId: '2:1', origin: { x: ORIGIN.x + 500, y: ORIGIN.y }, rootColors: ['#ffffff'],
  page: { id: '0:1', name: 'App' }, summary: {}, extractionTimeMs: 1,
  elements: [
    { ...el('2:2', '2:1', 'text', 'Back', 24, 40, 38, 24, { text: 'Back', fontSize: 16, fontWeight: 600, fontFamily: FONT, lineHeightPx: 24, letterSpacing: 0, textAlign: 'LEFT', textAutoResize: 'WIDTH_AND_HEIGHT', colors: ['#3346f0'],
      interactions: [{ trigger: 'ON_CLICK', action: 'BACK', transition: null }] }), x: ORIGIN.x + 500 + 24, y: ORIGIN.y + 40 },
    { ...el('2:3', '2:1', 'text', 'Heading', 24, 96, 342, 40, { text: 'Your projects', fontSize: 32, fontWeight: 700, fontFamily: FONT, lineHeightPx: 40, letterSpacing: 0, textAlign: 'LEFT', textAutoResize: 'HEIGHT', colors: ['#15172b'] }), x: ORIGIN.x + 500 + 24, y: ORIGIN.y + 96 },
    { ...el('2:4', '2:1', 'frame', 'Card', 24, 160, 342, 120, { colors: ['#e8ebfe'], radius: 16 }), x: ORIGIN.x + 500 + 24, y: ORIGIN.y + 160 },
  ],
};

function css(v) {
  const s = v === 'sloppy';
  return `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: "${FONT}", sans-serif; width: ${s ? '390px' : '100%'}; height: 844px; overflow: hidden; position: relative; }
  .screen { position: absolute; inset: 0; width: ${s ? '390px' : '100%'}; height: 844px; }
  .login { background: #f3f4f8; }
  .home { background: #ffffff; }
  .title, .heading { position: absolute; left: 24px; top: ${s ? 104 : 96}px; ${s ? 'width: 342px' : 'right: 24px'}; font-size: ${s ? 30 : 32}px; font-weight: 700; line-height: 40px; color: ${s ? '#333333' : '#15172b'}; }
  .subtitle { position: absolute; left: 24px; top: 144px; ${s ? 'width: 342px' : 'right: 24px'}; font-size: 16px; line-height: 24px; color: #5f6480; }
  .field { position: absolute; left: 24px; top: 200px; ${s ? 'width: 342px' : 'right: 24px'}; height: 52px; background: #fff; border: 1px solid #dde0ea; border-radius: ${s ? 4 : 10}px; }
  .button { position: absolute; left: 24px; top: 720px; ${s ? 'width: 342px' : 'right: 24px'}; font-family: ${s ? 'initial' : 'inherit'}; height: 52px; background: #3346f0; border: 0; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
  .button span { font-family: inherit; font-size: 16px; font-weight: 600; line-height: 20px; color: #fff; }
  .back { position: absolute; left: 24px; top: 40px; font-size: 16px; font-weight: 600; line-height: 24px; color: #3346f0; background: none; border: 0; padding: 0; cursor: pointer; font-family: inherit; }
  .heading { top: 96px; }
  .card { position: absolute; left: 24px; top: 160px; ${s ? 'width: 342px' : 'right: 24px'}; height: 120px; background: #e8ebfe; border-radius: ${s ? 4 : 16}px; }
  .enter { transform: translateX(390px); }
  .enter.go { transform: translateX(0); transition: transform 300ms cubic-bezier(0, 0, 0.58, 1); }`;
}

function html(variant) {
  const s = variant === 'sloppy';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title><style>${css(variant)}</style></head><body><div id="app"></div>
<script>
const app = document.getElementById('app');
function login() {
  return '<div class="screen login" data-fid="1:1">' +
    '<h1 class="title" data-fid="1:2">Welcome back</h1>' +
    '<p class="subtitle" data-fid="1:3">Sign in to keep building</p>' +
    '<div class="field" ${s ? '' : 'data-fid="1:4"'}></div>' +
    '<button class="button" ${s ? 'id="go"' : 'data-fid="1:5"'}><span data-fid="1:6">Sign in</span></button></div>';
}
function home(animate) {
  return '<div class="screen home ' + (animate ? 'enter' : '') + '" data-fid="2:1">' +
    '<button class="back" data-fid="2:2">Back</button>' +
    '<h1 class="heading" data-fid="2:3">Your projects</h1>' +
    '<div class="card" data-fid="2:4"></div></div>';
}
function render(animate) {
  const p = location.pathname;
  if (p === '/home') {
    app.innerHTML = home(animate && ${s ? 'false' : 'true'});
    const entering = app.querySelector('.enter');
    if (entering) requestAnimationFrame(() => requestAnimationFrame(() => entering.classList.add('go')));
    app.querySelector('.back').onclick = () => history.back();
  } else {
    app.innerHTML = login();
    app.querySelector('.button').onclick = () => { history.pushState({}, '', '/home'); render(true); };
  }
}
addEventListener('popstate', () => render(false));
render(false);
</script></body></html>`;
}

function manifest() {
  return { version: 1, appRoot: '.', screens: [ { name: 'Login', rootId: '1:1', route: '/login' }, { name: 'Home', rootId: '2:1', route: '/home' } ] };
}

function writeApp(dir, variant) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html(variant));
  fs.writeFileSync(path.join(dir, 'design-engineer.fidelity.json'), JSON.stringify(manifest(), null, 2));
}

/** Saved design_contexts.content shape: { contextVersion, ..., screen }. */
function contexts() {
  return [login, home].map((screen) => ({ name: screen.screen, context: { contextVersion: '3.0', screen } }));
}

module.exports = { writeApp, contexts, html, manifest, ORIGIN };
