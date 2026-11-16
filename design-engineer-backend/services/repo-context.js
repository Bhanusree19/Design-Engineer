'use strict';
// Repository context: reads a GitHub branch through the REST API (no clone)
// and works out which app is there, so the plugin does not have to ask.
//
//   analyzeRepository(gh, owner, repo, branch) -> context object
//   detectContext({ paths, packages })         -> pure detection (unit tested)
//   contextPromptLines(context)                -> lines for the agent prompt
//
// Everything read from the repository is untrusted. Only names that match
// strict patterns are kept, so repository text cannot steer the agent prompt.

const CONTEXT_VERSION = 1;
const MAX_PACKAGE_FILES = 6;
const MAX_PACKAGE_BYTES = 200 * 1024;
const MAX_COMPONENT_NAMES = 24;

const IGNORED_DIR = /(^|\/)(node_modules|\.git|dist|build|\.next|\.expo|ios\/Pods|android\/build|coverage|vendor)(\/|$)/;
const SAFE_PATH = /^[\w@.\-\/ ]{1,300}$/;
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]{1,60}$/;

function cleanVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/\d+(\.\d+){0,2}/);
  return match ? match[0] : null;
}
function dirOf(path) { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); }
function under(root, path) { return root === '' ? true : path === root || path.startsWith(root + '/'); }
function rel(root, path) { return root === '' ? path : path.slice(root.length + 1); }
function depth(path) { return path ? path.split('/').length : 0; }
function depsOf(pkg) {
  return { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
}
function has(deps, name) { return Object.prototype.hasOwnProperty.call(deps, name); }
function hasPrefix(deps, prefix) { return Object.keys(deps).some((k) => k.startsWith(prefix)); }

// Classify one package.json: is it an app we can build for?
function classifyPackage(pkg) {
  const deps = depsOf(pkg);
  // Documentation sites use React too, but they are not the app to build.
  if (has(deps, '@docusaurus/core') || has(deps, 'nextra')) return null;
  if (has(deps, 'expo')) return { stack: 'react-native', framework: 'expo', frameworkName: 'Expo' };
  if (has(deps, 'react-native')) return { stack: 'react-native', framework: 'react-native-cli', frameworkName: 'React Native CLI' };
  if (has(deps, 'next')) return { stack: 'react-js', framework: 'next', frameworkName: 'Next.js' };
  if (hasPrefix(deps, '@remix-run/')) return { stack: 'react-js', framework: 'remix', frameworkName: 'Remix' };
  if (has(deps, 'gatsby')) return { stack: 'react-js', framework: 'gatsby', frameworkName: 'Gatsby' };
  if (has(deps, 'react-scripts')) return { stack: 'react-js', framework: 'create-react-app', frameworkName: 'Create React App' };
  if (has(deps, 'react-dom') || (has(deps, 'react') && has(deps, 'vite'))) {
    return { stack: 'react-js', framework: has(deps, 'vite') ? 'vite' : 'react', frameworkName: has(deps, 'vite') ? 'React + Vite' : 'React' };
  }
  if (has(deps, 'vue') || has(deps, 'nuxt')) return { unsupported: 'Vue' };
  if (has(deps, '@angular/core')) return { unsupported: 'Angular' };
  if (has(deps, 'svelte') || has(deps, '@sveltejs/kit')) return { unsupported: 'Svelte' };
  if (has(deps, 'solid-js')) return { unsupported: 'Solid' };
  return null;
}

const STYLING = [
  ['nativewind', 'NativeWind'], ['tailwindcss', 'Tailwind CSS'], ['styled-components', 'styled-components'],
  ['@emotion/react', 'Emotion'], ['@emotion/styled', 'Emotion'], ['sass', 'Sass'], ['@vanilla-extract/css', 'vanilla-extract'],
  ['@stitches/react', 'Stitches'], ['@shopify/restyle', 'Restyle'], ['react-native-unistyles', 'Unistyles'], ['twrnc', 'twrnc'],
];
const UI_LIBS = [
  ['@mui/material', 'MUI'], ['@chakra-ui/react', 'Chakra UI'], ['antd', 'Ant Design'], ['@mantine/core', 'Mantine'],
  ['@headlessui/react', 'Headless UI'], ['react-native-paper', 'React Native Paper'], ['tamagui', 'Tamagui'],
  ['@gluestack-ui/themed', 'gluestack-ui'], ['native-base', 'NativeBase'], ['@rneui/themed', 'React Native Elements'],
  ['react-native-elements', 'React Native Elements'], ['@ui-kitten/components', 'UI Kitten'],
];
const NAVIGATION = [
  ['expo-router', 'Expo Router'], ['@react-navigation/native', 'React Navigation'], ['react-router-dom', 'React Router'],
  ['react-router', 'React Router'], ['@tanstack/react-router', 'TanStack Router'], ['wouter', 'wouter'],
];
const STATE = [
  ['@reduxjs/toolkit', 'Redux Toolkit'], ['redux', 'Redux'], ['zustand', 'Zustand'], ['@tanstack/react-query', 'TanStack Query'],
  ['jotai', 'Jotai'], ['mobx', 'MobX'], ['recoil', 'Recoil'], ['swr', 'SWR'],
];
const TESTING = [
  ['vitest', 'Vitest'], ['jest', 'Jest'], ['@testing-library/react-native', 'React Native Testing Library'],
  ['@testing-library/react', 'React Testing Library'], ['@playwright/test', 'Playwright'], ['cypress', 'Cypress'], ['detox', 'Detox'],
];
function pick(deps, table) {
  const out = [];
  for (const [name, label] of table) if (has(deps, name) && !out.includes(label)) out.push(label);
  return out;
}

const COMPONENT_DIRS = ['components', 'src/components', 'app/components', 'src/ui', 'ui', 'src/shared/components', 'packages/ui/src'];
const SCREEN_DIRS = ['src/screens', 'screens', 'app', 'src/app', 'src/pages', 'pages', 'src/routes', 'src/views'];
const SOURCE_FILE = /\.(tsx|jsx|ts|js)$/;
const NOT_COMPONENT = /(\.test\.|\.spec\.|\.stories\.|\.d\.ts$|(^|\/)index\.(t|j)sx?$|(^|\/)__)/;

function packageManagerFor(root, fileSet, pkg) {
  const field = typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0] : '';
  if (['npm', 'yarn', 'pnpm', 'bun'].includes(field)) return field;
  for (const dir of root === '' ? [''] : [root, '']) {
    const p = (f) => (dir ? dir + '/' + f : f);
    if (fileSet.has(p('pnpm-lock.yaml'))) return 'pnpm';
    if (fileSet.has(p('yarn.lock'))) return 'yarn';
    if (fileSet.has(p('bun.lockb')) || fileSet.has(p('bun.lock'))) return 'bun';
    if (fileSet.has(p('package-lock.json'))) return 'npm';
  }
  return null;
}

function describeApp(app, files, fileSet) {
  const { root, pkg } = app;
  const deps = depsOf(pkg);
  const inApp = files.filter((f) => under(root, f));
  const relPaths = inApp.map((f) => rel(root, f));
  const relSet = new Set(relPaths);

  const typescript = relSet.has('tsconfig.json') || has(deps, 'typescript') || relPaths.some((f) => /\.tsx?$/.test(f));
  const styling = pick(deps, STYLING);
  if (relPaths.some((f) => /\.module\.(css|scss)$/.test(f))) styling.push('CSS Modules');
  if (!styling.length && app.stack === 'react-native') styling.push('StyleSheet');
  if (!styling.length && relPaths.some((f) => /\.(css|scss)$/.test(f))) styling.push('Plain CSS');

  const uiLibraries = pick(deps, UI_LIBS);
  if (relSet.has('components.json') && has(deps, 'tailwindcss')) uiLibraries.unshift('shadcn/ui');
  else if (hasPrefix(deps, '@radix-ui/')) uiLibraries.push('Radix UI');

  const navigation = pick(deps, NAVIGATION);
  if (app.framework === 'next') navigation.push(relPaths.some((f) => /^(src\/)?app\//.test(f)) ? 'Next.js App Router' : 'Next.js Pages Router');

  const componentDirs = COMPONENT_DIRS.filter((d) => relPaths.some((f) => f.startsWith(d + '/')));
  const componentNames = [];
  let componentCount = 0;
  for (const f of relPaths) {
    if (!componentDirs.some((d) => f.startsWith(d + '/'))) continue;
    if (!SOURCE_FILE.test(f) || NOT_COMPONENT.test(f)) continue;
    const base = f.split('/').pop().replace(SOURCE_FILE, '');
    const name = base === 'index' ? null : base;
    if (!name || !COMPONENT_NAME.test(name)) continue;
    componentCount++;
    if (componentNames.length < MAX_COMPONENT_NAMES && !componentNames.includes(name)) componentNames.push(name);
  }
  const screenDirs = SCREEN_DIRS.filter((d) => relPaths.some((f) => f.startsWith(d + '/') && SOURCE_FILE.test(f)));
  const themeFiles = relPaths
    .filter((f) => /(^|\/)(theme|tokens|colors|design-tokens)(\/|\.)|tailwind\.config\.(js|ts|cjs|mjs)$/i.test(f))
    .filter((f) => SAFE_PATH.test(f)).slice(0, 8);

  const scripts = Object.keys(pkg?.scripts || {})
    .filter((s) => /^(dev|start|ios|android|web|build|test|lint|typecheck)$/.test(s));

  return {
    root: root || '.',
    stack: app.stack,
    framework: app.framework,
    frameworkName: app.frameworkName,
    versions: {
      react: cleanVersion(deps.react),
      reactNative: cleanVersion(deps['react-native']),
      expo: cleanVersion(deps.expo),
      next: cleanVersion(deps.next),
    },
    language: typescript ? 'typescript' : 'javascript',
    packageManager: packageManagerFor(root, fileSet, pkg),
    styling,
    uiLibraries,
    navigation,
    state: pick(deps, STATE),
    testing: pick(deps, TESTING),
    components: { dirs: componentDirs, count: componentCount, names: componentNames },
    screenDirs,
    themeFiles,
    scripts,
  };
}

// Pure detection from a list of file paths and parsed package.json files.
function detectContext({ paths, packages, truncated = false }) {
  const files = (paths || []).filter((p) => typeof p === 'string' && SAFE_PATH.test(p) && !IGNORED_DIR.test(p));
  const fileSet = new Set(files);
  const base = { version: CONTEXT_VERSION, truncated: !!truncated, fileCount: files.length };

  const apps = [];
  let unsupported = null;
  for (const { path, json } of packages || []) {
    const kind = classifyPackage(json);
    if (!kind) continue;
    if (kind.unsupported) { unsupported = unsupported || kind.unsupported; continue; }
    apps.push({ root: dirOf(path), pkg: json, ...kind });
  }
  if (!apps.length) {
    if (fileSet.has('pubspec.yaml')) unsupported = unsupported || 'Flutter';
    if (!unsupported && files.some((f) => /\.xcodeproj\//.test(f)) && !files.some((f) => /package\.json$/.test(f))) unsupported = 'native iOS';
    if (!unsupported && fileSet.has('build.gradle') && !files.some((f) => /package\.json$/.test(f))) unsupported = 'native Android';
  }

  if (apps.length) {
    const stacks = [...new Set(apps.map((a) => a.stack))];
    const described = apps.map((a) => describeApp(a, files, fileSet));
    if (stacks.length > 1) {
      return { ...base, status: 'multiple-apps', stack: null, apps: described,
        summary: 'This branch has both a React Native and a React JS app.' };
    }
    // Same stack in several packages (e.g. a monorepo): build in the shallowest app.
    described.sort((a, b) => depth(a.root === '.' ? '' : a.root) - depth(b.root === '.' ? '' : b.root));
    const app = described[0];
    return { ...base, status: 'existing-app', stack: app.stack, app, apps: described, summary: summarize(app) };
  }
  if (unsupported) {
    return { ...base, status: 'unsupported', stack: null, detectedOther: unsupported,
      summary: `This branch contains a ${unsupported} project. Design Engineer builds React JS or React Native.` };
  }
  const meaningful = files.filter((f) => !/(^|\/)(readme(\.\w+)?|license(\.\w+)?|\.gitignore|\.gitattributes|\.editorconfig|\.github\/.*)$/i.test(f));
  return { ...base, status: meaningful.length ? 'no-app' : 'empty', stack: null,
    summary: meaningful.length ? 'No React or React Native app found on this branch yet.' : 'This branch is empty apart from its README.' };
}

function summarize(app) {
  const bits = [app.frameworkName, app.language === 'typescript' ? 'TypeScript' : 'JavaScript'];
  if (app.styling[0]) bits.push(app.styling[0]);
  if (app.uiLibraries[0]) bits.push(app.uiLibraries[0]);
  if (app.navigation[0]) bits.push(app.navigation[0]);
  if (app.components.count) bits.push(`${app.components.count} component${app.components.count === 1 ? '' : 's'}`);
  return bits.join(', ');
}

// Lines appended to the implementation prompt. Only allow-listed values.
function contextPromptLines(ctx) {
  if (!ctx || ctx.status !== 'existing-app' || !ctx.app) return [];
  const a = ctx.app;
  const list = (xs) => (xs && xs.length ? xs.join(', ') : 'none detected');
  const lines = [
    'Repository context detected by Design Engineer before this build (verify against the files; the files win if they disagree):',
    `- App root: ${a.root}`,
    `- Framework: ${a.frameworkName}${a.versions.expo ? ' SDK ' + a.versions.expo : ''}${a.versions.reactNative ? ', react-native ' + a.versions.reactNative : ''}${a.versions.next ? ', next ' + a.versions.next : ''}${a.versions.react ? ', react ' + a.versions.react : ''}`,
    `- Language: ${a.language === 'typescript' ? 'TypeScript (write .tsx)' : 'JavaScript (write .jsx)'}`,
    `- Package manager: ${a.packageManager || 'not detected'}`,
    `- Styling: ${list(a.styling)}. Use the same styling approach; do not introduce another one.`,
    `- UI libraries: ${list(a.uiLibraries)}. Prefer their components over new hand-made ones.`,
    `- Navigation: ${list(a.navigation)}. Register new screens in the existing navigation.`,
    `- State and data: ${list(a.state)}`,
    `- Tests: ${list(a.testing)}`,
  ];
  if (a.components.count) {
    lines.push(`- Existing components (${a.components.count}) in ${a.components.dirs.join(', ')}: ${a.components.names.join(', ')}${a.components.count > a.components.names.length ? ', …' : ''}. Reuse or extend these before creating new ones.`);
  }
  if (a.themeFiles.length) lines.push(`- Theme and token files: ${a.themeFiles.join(', ')}. Map Figma colours and text styles to these tokens.`);
  if (a.screenDirs.length) lines.push(`- Screens or routes live in: ${a.screenDirs.join(', ')}`);
  if (a.scripts.length) lines.push(`- package.json scripts available: ${a.scripts.join(', ')}`);
  return lines;
}

// ----------------------------------------------------------------------------
// GitHub I/O. `gh(endpoint, accept)` must return a fetch Response.
async function analyzeRepository(gh, owner, repo, branch) {
  const o = encodeURIComponent(owner), r = encodeURIComponent(repo);
  const repoRes = await gh(`/repos/${o}/${r}`, 'application/vnd.github+json');
  if (repoRes.status === 401) { const e = new Error('GitHub authorization expired.'); e.code = 'GITHUB_REAUTH_REQUIRED'; throw e; }
  if (repoRes.status === 404) return { version: CONTEXT_VERSION, status: 'repo-not-found', stack: null, summary: 'Repository not found or not shared with Design Engineer.' };
  if (!repoRes.ok) throw new Error('GitHub repository lookup failed (' + repoRes.status + ').');

  const treeRes = await gh(`/repos/${o}/${r}/git/trees/${encodeURIComponent(branch)}?recursive=1`, 'application/vnd.github+json');
  if (treeRes.status === 409) return { version: CONTEXT_VERSION, status: 'empty', stack: null, fileCount: 0, summary: 'This repository has no commits yet.' };
  if (treeRes.status === 404) return { version: CONTEXT_VERSION, status: 'branch-not-found', stack: null, summary: `Branch "${branch}" was not found.` };
  if (!treeRes.ok) throw new Error('GitHub file list failed (' + treeRes.status + ').');
  const tree = await treeRes.json();
  const blobs = (tree.tree || []).filter((t) => t.type === 'blob').map((t) => ({ path: t.path, size: t.size || 0 }));
  const paths = blobs.map((b) => b.path);

  const pkgFiles = blobs
    .filter((b) => /(^|\/)package\.json$/.test(b.path) && !IGNORED_DIR.test(b.path) && depth(b.path) <= 4 && b.size <= MAX_PACKAGE_BYTES)
    .sort((a, b) => depth(a.path) - depth(b.path))
    .slice(0, MAX_PACKAGE_FILES);
  const packages = [];
  for (const file of pkgFiles) {
    const res = await gh(`/repos/${o}/${r}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
      'application/vnd.github.raw+json');
    if (!res.ok) continue;
    try { packages.push({ path: file.path, json: JSON.parse(await res.text()) }); } catch { /* invalid package.json */ }
  }
  const ctx = detectContext({ paths, packages, truncated: !!tree.truncated });
  return { ...ctx, repository: `${owner}/${repo}`, branch, analyzedAt: new Date().toISOString() };
}

module.exports = { analyzeRepository, detectContext, contextPromptLines, classifyPackage, CONTEXT_VERSION };
