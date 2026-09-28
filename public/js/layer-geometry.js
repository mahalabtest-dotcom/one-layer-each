// Turns a flat phone drawing into a solid, printable 3D layer.
//
// 1. The drawing is sampled onto a grid and every cell becomes "ink" or "empty".
// 2. Thin strokes are thickened and closed outlines are filled in.
// 3. Marching squares traces the outline (holes included) and the shape is
//    extruded into a slab with a top, a bottom and real side walls.
// 4. The side walls get vertex colors from the nearest ink; the top face gets
//    the drawing itself as a texture.

import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, nearestPaletteIndex } from './palette.js';

const N = 144; // grid resolution
const PADDING = 3;
const M = N + PADDING * 2;
const ISO = 0.5;
const PALETTE_COLORS = PALETTE.map((p) => new THREE.Color(p.hex));

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * @param {HTMLImageElement} img drawing (transparent background)
 * @param {{ size:number, height:number, usedFill:boolean }} opts
 */
export function buildLayer(img, { size = 10, height = 0.32, usedFill = false } = {}) {
  // ---- 1. sample to grid
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(img, 0, 0, N, N);
  const px = cx.getImageData(0, 0, N, N).data;

  let ink = new Uint8Array(N * N);
  let col = new Int8Array(N * N).fill(-1);
  const counts = new Array(PALETTE.length).fill(0);
  for (let i = 0; i < N * N; i++) {
    if (px[i * 4 + 3] > 60) {
      ink[i] = 1;
      col[i] = nearestPaletteIndex(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      counts[col[i]]++;
    }
  }
  const dominant = counts.indexOf(Math.max(...counts));

  // ---- 2a. thicken strokes by one cell
  ({ ink, col } = dilate(ink, col));

  // ---- 2b. fill closed outlines (unless the player used the bucket on purpose)
  if (!usedFill) fillEnclosed(ink, col, dominant);

  // colour grid for the top texture: spread colours a bit further so the
  // texture always covers the mesh edge
  let texInk = ink, texCol = col;
  for (let k = 0; k < 2; k++) ({ ink: texInk, col: texCol } = dilate(texInk, texCol));

  // ---- 3. scalar field (padded + blurred) for smooth contours
  let field = new Float32Array(M * M);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) field[(j + PADDING) * M + i + PADDING] = ink[j * N + i];
  field = blur(blur(field));

  const cell = size / N;
  const X = (fi) => (fi - PADDING + 0.5) * cell - size / 2;
  const Y = (fj) => size / 2 - (fj - PADDING + 0.5) * cell;

  const colorAt = (fx, fy) => {
    const gi = Math.round(fx) - PADDING, gj = Math.round(fy) - PADDING;
    for (let r = 0; r <= 3; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const a = gi + di, b = gj + dj;
        if (a < 0 || b < 0 || a >= N || b >= N) continue;
        const k = col[b * N + a];
        if (k >= 0) return k;
      }
    }
    return dominant;
  };

  const top = { pos: [], uv: [], color: [] };
  const bottom = { pos: [], uv: [], color: [] };
  const side = { pos: [], uv: [], color: [] };
  const segments = []; // outline segments for the "nozzle" trace, in 2D

  const pushV = (g, x, y, z, u, v, k) => {
    g.pos.push(x, y, z); g.uv.push(u, v);
    const C = PALETTE_COLORS[k];
    g.color.push(C.r, C.g, C.b);
  };
  const topUV = (x, y) => [(x + size / 2) / size, (y + size / 2) / size];

  const addPolygon = (poly, k) => {
    // poly: array of [x, y] in CCW order (2D). top at z=h, bottom at z=0
    for (let t = 1; t < poly.length - 1; t++) {
      const a = poly[0], b = poly[t], d = poly[t + 1];
      for (const p of [a, b, d]) pushV(top, p[0], p[1], height, ...topUV(p[0], p[1]), k);
      for (const p of [a, d, b]) pushV(bottom, p[0], p[1], 0, ...topUV(p[0], p[1]), k);
    }
  };
  const addWall = (a, b, ka, kb) => {
    // a -> b along the contour (interior on the left): outward-facing quad
    const [ax, ay] = a, [bx, by] = b;
    pushV(side, ax, ay, 0, 0, 0, ka); pushV(side, bx, by, 0, 0, 0, kb); pushV(side, bx, by, height, 0, 1, kb);
    pushV(side, ax, ay, 0, 0, 0, ka); pushV(side, bx, by, height, 0, 1, kb); pushV(side, ax, ay, height, 0, 1, ka);
    segments.push([ax, ay, bx, by]);
  };

  // ---- marching squares
  const F = (i, j) => field[j * M + i];
  const full = new Uint8Array(M * M);
  for (let j = 0; j < M - 1; j++) {
    for (let i = 0; i < M - 1; i++) {
      // corners CCW (y up): bottom-left, bottom-right, top-right, top-left
      const P = [[i, j + 1], [i + 1, j + 1], [i + 1, j], [i, j]];
      const v = P.map(([a, b]) => F(a, b));
      const ins = v.map((x) => x >= ISO);
      const n = ins.filter(Boolean).length;
      if (n === 0) continue;
      if (n === 4) { full[j * M + i] = 1; continue; }

      const items = [];
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        if (ins[k]) items.push({ f: P[k], corner: true });
        if (ins[k] !== ins[k2]) {
          const t = (ISO - v[k]) / (v[k2] - v[k]);
          items.push({ f: [P[k][0] + (P[k2][0] - P[k][0]) * t, P[k][1] + (P[k2][1] - P[k][1]) * t], corner: false });
        }
      }
      let polys;
      const saddle = n === 2 && ins[0] === ins[2];
      if (saddle && (v[0] + v[1] + v[2] + v[3]) / 4 < ISO) {
        polys = [];
        items.forEach((it, idx) => {
          if (!it.corner) return;
          const L = items.length;
          polys.push([items[(idx - 1 + L) % L], it, items[(idx + 1) % L]]);
        });
      } else polys = [items];

      for (const poly of polys) {
        const pts = poly.map((it) => [X(it.f[0]), Y(it.f[1])]);
        const kCell = colorAt(i + 0.5, j + 0.5);
        addPolygon(pts, kCell);
        for (let q = 0; q < poly.length; q++) {
          const A = poly[q], B = poly[(q + 1) % poly.length];
          if (!A.corner && !B.corner) addWall(pts[q], pts[(q + 1) % poly.length], colorAt(...A.f), colorAt(...B.f));
        }
      }
    }
  }
  // merge runs of fully-inside cells into long quads
  for (let j = 0; j < M - 1; j++) {
    let i = 0;
    while (i < M - 1) {
      if (!full[j * M + i]) { i++; continue; }
      let e = i;
      while (e + 1 < M - 1 && full[j * M + e + 1]) e++;
      // overlap neighbouring rows slightly: hides hairline cracks at T-junctions
      const o = cell * 0.3;
      addPolygon([[X(i), Y(j + 1) - o], [X(e + 1), Y(j + 1) - o], [X(e + 1), Y(j) + o], [X(i), Y(j) + o]], colorAt(i + 0.5, j + 0.5));
      i = e + 1;
    }
  }

  // ---- assemble geometry: group 0 = top (textured), group 1 = sides + bottom
  const toGeo = (g, normal) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.color, 3));
    if (normal) {
      const nrm = new Float32Array(g.pos.length);
      for (let q = 0; q < nrm.length; q += 3) { nrm[q] = normal[0]; nrm[q + 1] = normal[1]; nrm[q + 2] = normal[2]; }
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    }
    return geo;
  };
  if (!top.pos.length) return null;

  const topGeo = toGeo(top, [0, 0, 1]);
  const bottomGeo = toGeo(bottom, [0, 0, -1]);
  let sideGeo = toGeo(side, null);
  sideGeo = mergeVertices(sideGeo, 1e-5);
  sideGeo.computeVertexNormals();
  sideGeo = sideGeo.toNonIndexed();

  const sideAndBottom = mergeGeometries([sideGeo, bottomGeo], false);
  const geometry = mergeGeometries([topGeo, sideAndBottom], true);
  geometry.rotateX(-Math.PI / 2); // extrusion axis (z) becomes world up (y)
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // ---- top texture: colour grid underneath, the real drawing on top
  const grid = document.createElement('canvas');
  grid.width = grid.height = N;
  const gx = grid.getContext('2d');
  const gd = gx.createImageData(N, N);
  for (let q = 0; q < N * N; q++) {
    if (!texInk[q]) continue;
    const k = texCol[q] >= 0 ? texCol[q] : dominant;
    const hex = PALETTE[k].hex;
    gd.data[q * 4] = parseInt(hex.slice(1, 3), 16);
    gd.data[q * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    gd.data[q * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    gd.data[q * 4 + 3] = 255;
  }
  gx.putImageData(gd, 0, 0);
  const texCanvas = document.createElement('canvas');
  texCanvas.width = texCanvas.height = 512;
  const tx = texCanvas.getContext('2d');
  tx.fillStyle = PALETTE[dominant].hex;
  tx.fillRect(0, 0, 512, 512);
  tx.imageSmoothingEnabled = true;
  tx.drawImage(grid, 0, 0, 512, 512);
  tx.drawImage(img, 0, 0, 512, 512);
  const texture = new THREE.CanvasTexture(texCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  return {
    geometry,
    texture,
    dominant,
    dominantColor: PALETTE_COLORS[dominant].clone(),
    path: orderPath(segments),
  };
}

// ---------------------------------------------------------------- helpers
function dilate(ink, col) {
  const ink2 = new Uint8Array(ink), col2 = new Int8Array(col);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const q = j * N + i;
    if (ink[q]) continue;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const r = b * N + a;
      if (ink[r]) { ink2[q] = 1; col2[q] = col[r]; }
    }
  }
  return { ink: ink2, col: col2 };
}

function fillEnclosed(ink, col, dominant) {
  const outside = new Uint8Array(N * N);
  const stack = [];
  for (let k = 0; k < N; k++) stack.push(k, (N - 1) * N + k, k * N, k * N + N - 1);
  while (stack.length) {
    const q = stack.pop();
    if (outside[q] || ink[q]) continue;
    outside[q] = 1;
    const i = q % N, j = (q - i) / N;
    if (i > 0) stack.push(q - 1);
    if (i < N - 1) stack.push(q + 1);
    if (j > 0) stack.push(q - N);
    if (j < N - 1) stack.push(q + N);
  }
  for (let j = 0; j < N; j++) {
    let last = dominant;
    for (let i = 0; i < N; i++) {
      const q = j * N + i;
      if (ink[q] && col[q] >= 0) last = col[q];
      else if (!ink[q] && !outside[q]) { ink[q] = 1; col[q] = last; }
    }
  }
}

function blur(f) {
  const out = new Float32Array(f.length), tmp = new Float32Array(f.length);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    let s = 0, n = 0;
    for (let d = -1; d <= 1; d++) { const a = i + d; if (a >= 0 && a < M) { s += f[j * M + a]; n++; } }
    tmp[j * M + i] = s / n;
  }
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    let s = 0, n = 0;
    for (let d = -1; d <= 1; d++) { const b = j + d; if (b >= 0 && b < M) { s += tmp[b * M + i]; n++; } }
    out[j * M + i] = s / n;
  }
  return out;
}

// Chain loose contour segments into continuous loops, then order the loops so
// the nozzle travels a short distance between them.
function orderPath(segs) {
  const key = (x, y) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
  const byStart = new Map();
  segs.forEach((s, idx) => {
    const k = key(s[0], s[1]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(idx);
  });
  const used = new Uint8Array(segs.length);
  const chains = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    const chain = [];
    let cur = s0;
    while (cur !== undefined && !used[cur]) {
      used[cur] = 1;
      chain.push(segs[cur]);
      const nextList = byStart.get(key(segs[cur][2], segs[cur][3])) || [];
      cur = nextList.find((n) => !used[n]);
    }
    chains.push(chain);
  }
  // drop specks, sort by nearest neighbour
  const big = chains.filter((c) => c.length > 2);
  const ordered = [];
  let px = 0, py = 0;
  while (big.length) {
    let best = 0, bestD = Infinity;
    big.forEach((c, i) => { const d = (c[0][0] - px) ** 2 + (c[0][1] - py) ** 2; if (d < bestD) { bestD = d; best = i; } });
    const c = big.splice(best, 1)[0];
    ordered.push(c);
    const last = c[c.length - 1];
    px = last[2]; py = last[3];
  }
  return ordered; // array of chains; each chain is [ax, ay, bx, by][]
}
