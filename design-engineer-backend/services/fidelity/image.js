'use strict';
// Visual comparison between the Figma reference export and the rendered page:
// PNG decode, resampling to a common size, block SSIM, and a small heatmap.
const { PNG } = require('pngjs');

function decodePng(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input || ''), 'base64');
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

/** Area-average resample (good for downscaling 2x exports; fine for small upscales). */
function resample(img, width, height) {
  if (img.width === width && img.height === height) return img;
  const out = Buffer.alloc(width * height * 4);
  const sx = img.width / width, sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = y * sy, y1 = Math.max(y0 + 1e-6, (y + 1) * sy);
    for (let x = 0; x < width; x++) {
      const x0 = x * sx, x1 = Math.max(x0 + 1e-6, (x + 1) * sx);
      const acc = [0, 0, 0, 0]; let wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.height, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.min(img.width, Math.ceil(x1)); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          if (wx <= 0) continue;
          const w = wx * wy, i = (yy * img.width + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += img.data[i + c] * w;
          wsum += w;
        }
      }
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = wsum ? Math.round(acc[c] / wsum) : 0;
    }
  }
  return { width, height, data: out };
}

/** Luma over a white backdrop, so transparent export areas compare as white page. */
function luma(img) {
  const n = img.width * img.height;
  const out = new Float64Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = img.data[i + 3] / 255;
    const r = img.data[i] * a + 255 * (1 - a);
    const g = img.data[i + 1] * a + 255 * (1 - a);
    const b = img.data[i + 2] * a + 255 * (1 - a);
    out[p] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

/**
 * Block SSIM: 8×8 windows on luma. Returns the mean SSIM and a per-block map
 * (used for the heatmap and to locate the worst regions).
 */
function ssim(a, b, { block = 8 } = {}) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('ssim: images must be the same size');
  const { width, height } = a;
  const la = luma(a), lb = luma(b);
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  const cols = Math.ceil(width / block), rows = Math.ceil(height / block);
  const map = new Float64Array(cols * rows);
  let total = 0, contentTotal = 0, contentBlocks = 0;
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let n = 0, ma = 0, mb = 0;
      const x1 = Math.min(width, (bx + 1) * block), y1 = Math.min(height, (by + 1) * block);
      for (let y = by * block; y < y1; y++) for (let x = bx * block; x < x1; x++) {
        const i = y * width + x; ma += la[i]; mb += lb[i]; n++;
      }
      ma /= n; mb /= n;
      let va = 0, vb = 0, cov = 0;
      for (let y = by * block; y < y1; y++) for (let x = bx * block; x < x1; x++) {
        const i = y * width + x; const da = la[i] - ma, db = lb[i] - mb;
        va += da * da; vb += db * db; cov += da * db;
      }
      va /= n; vb /= n; cov /= n;
      const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      map[by * cols + bx] = s;
      total += s;
      // Blocks with something on them: texture, an edge, or a flat colour that
      // changed. Empty background would otherwise dilute every real difference.
      if (va > 4 || vb > 4 || Math.abs(ma - mb) > 2) { contentTotal += s; contentBlocks++; }
    }
  }
  return { score: total / map.length, content: contentBlocks ? contentTotal / contentBlocks : 1, contentBlocks, map, cols, rows, block };
}

/** Share of pixels whose channels all differ by ≤ tolerance (0..255). */
function pixelMatch(a, b, tolerance = 24) {
  let same = 0;
  const n = a.width * a.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) <= tolerance && Math.abs(a.data[i + 1] - b.data[i + 1]) <= tolerance &&
        Math.abs(a.data[i + 2] - b.data[i + 2]) <= tolerance) same++;
  }
  return same / n;
}

/**
 * Small PNG heatmap: the rendered screen dimmed to grey, with mismatched
 * blocks tinted red by how far their SSIM is from 1. Width ≈ maxWidth.
 */
function heatmapPng(rendered, ssimResult, { maxWidth = 180 } = {}) {
  const scale = Math.min(1, maxWidth / rendered.width);
  const w = Math.max(1, Math.round(rendered.width * scale));
  const h = Math.max(1, Math.round(rendered.height * scale));
  const small = resample(rendered, w, h);
  const png = new PNG({ width: w, height: h });
  const { map, cols, rows, block } = ssimResult;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = 0.299 * small.data[i] + 0.587 * small.data[i + 1] + 0.114 * small.data[i + 2];
      const grey = 150 + g * 0.4;
      const bx = Math.min(cols - 1, Math.floor(x / scale / block));
      const by = Math.min(rows - 1, Math.floor(y / scale / block));
      const bad = Math.max(0, Math.min(1, (0.97 - map[by * cols + bx]) / 0.5));
      png.data[i] = Math.round(grey * (1 - bad) + 230 * bad);
      png.data[i + 1] = Math.round(grey * (1 - bad) + 40 * bad);
      png.data[i + 2] = Math.round(grey * (1 - bad) + 60 * bad);
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png).toString('base64');
}

/** Bounding boxes (in image px) of the worst SSIM blocks, merged per block. */
function worstRegions(ssimResult, { limit = 5, threshold = 0.8 } = {}) {
  const { map, cols, block } = ssimResult;
  return Array.from(map, (s, i) => ({ s, i }))
    .filter((b) => b.s < threshold)
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map(({ s, i }) => ({ x: (i % cols) * block, y: Math.floor(i / cols) * block, w: block, h: block, ssim: s }));
}

/**
 * The rendered screen as users will see it, for the build preview: kept at
 * 1x for phone frames, scaled down to maxWidth for wide (desktop) frames.
 */
function previewPng(rendered, { maxWidth = 480 } = {}) {
  const scale = Math.min(1, maxWidth / rendered.width);
  const img = scale < 1 ? resample(rendered, Math.round(rendered.width * scale), Math.round(rendered.height * scale)) : rendered;
  const png = new PNG({ width: img.width, height: img.height });
  img.data.copy(png.data);
  return PNG.sync.write(png, { colorType: 2 }).toString('base64');
}

function encodePng({ width, height, data }) {
  const png = new PNG({ width, height });
  data.copy(png.data);
  return PNG.sync.write(png);
}

module.exports = { decodePng, encodePng, previewPng, resample, ssim, pixelMatch, heatmapPng, worstRegions };
