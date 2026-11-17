// Builds website/dist from website/src, filling %%KEY%% tokens from
// site.config.json. `node build.mjs --strict` fails while any value is still
// a [BRACKETED] placeholder (use it before going live / Razorpay review).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src'), dist = join(root, 'dist');
const config = JSON.parse(readFileSync(join(root, 'site.config.json'), 'utf8'));
const strict = process.argv.includes('--strict');

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pending = Object.entries(config).filter(([, v]) => typeof v === 'string' && /^\[.*\]$/.test(v.trim()));
if (strict && pending.length) {
  console.error('Fill these in website/site.config.json before going live:\n  ' + pending.map(([k, v]) => `${k} = ${v}`).join('\n  '));
  process.exit(1);
}
const siteUrl = String(config.SITE_URL || '').replace(/\/+$/, '');

rmSync(dist, { recursive: true, force: true });
const used = new Set();
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const from = join(dir, name), to = join(dist, from.slice(src.length + 1));
    if (statSync(from).isDirectory()) { walk(from); continue; }
    mkdirSync(dirname(to), { recursive: true });
    if (['.html', '.xml', '.txt'].includes(extname(name))) {
      const text = readFileSync(from, 'utf8').replace(/%%([A-Z_]+)%%/g, (m, key) => {
        if (!(key in config)) throw new Error(`${name}: unknown token ${m}`);
        used.add(key);
        return escapeHtml(key === 'SITE_URL' ? siteUrl : config[key]);
      });
      writeFileSync(to, text);
    } else copyFileSync(from, to);
  }
}
walk(src);
console.log(`Built website/dist (${[...used].length} config values used).`);
if (pending.length) console.log(`Still placeholders: ${pending.map(([k]) => k).join(', ')}`);
