import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { createStage, PLATE, makeBeadTexture, makeInfillTexture } from './scene.js';
import { loadImage, buildLayer } from './layer-geometry.js';
import { makeDemoDrawings } from './demo.js';
import { PrinterSound } from './sound.js';
import { PALETTE } from './palette.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ================================================================== stage
const stage = createStage($('scene'));
const { scene, camera, controls, composer, rig, renderer } = stage;
const sound = new PrinterSound();
const beadTex = makeBeadTexture(3);
const infillTex = makeInfillTexture();
const stack = new THREE.Group();
scene.add(stack);

const LOBBY_CAM = { pos: new THREE.Vector3(19, 10.5, 21), target: new THREE.Vector3(0, 2.6, 0) };
camera.position.copy(LOBBY_CAM.pos);
controls.target.copy(LOBBY_CAM.target);
rig.setPosition(PLATE / 2 - 0.6, 0.9, PLATE / 2 - 0.6);

// ================================================================== state
const layers = new Map(); // id -> { id, name, image, usedFill }
let server = { phase: 'open', expected: 28, joinUrl: '', players: 0, order: [], timerEnd: null };
let mode = 'lobby'; // lobby | slicing | printing | finale
let demo = false;
let job = null; // current print job
let jobToken = 0;
const view = { x: 0.23, y: 0, tx: 0.23, ty: 0 };

function setMode(m) {
  mode = m;
  document.body.className = `mode-${m} phase-${server.phase}`;
  $('lobby').setAttribute('aria-hidden', m !== 'lobby');
  $('slicing').hidden = m !== 'slicing';
  $('hud').hidden = m !== 'printing';
  $('finale').hidden = m !== 'finale';
  $('finale-tools').hidden = m !== 'finale';
  if (m !== 'finale') deselect();
  view.tx = m === 'lobby' ? 0.23 : 0;
  view.ty = m === 'finale' ? 0.11 : 0;
}

// ================================================================== tweens
const tweens = [];
let simTime = 0;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
function tween(dur, fn, ease = easeInOut) {
  return new Promise((res) => tweens.push({ t: 0, dur, fn, ease, res }));
}
let flying = 0;
async function flyTo(pos, target, dur = 2.2) {
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  flying++;
  await tween(dur, (e) => { camera.position.lerpVectors(p0, pos, e); controls.target.lerpVectors(t0, target, e); });
  flying--;
}

// ================================================================== lobby tiles (drawings orbiting the plate)
const tiles = new Map(); // id -> { mesh, born, leaving }
const tileGeo = new THREE.PlaneGeometry(1.8, 2.05);
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
async function addTile(layer) {
  const old = tiles.get(layer.id);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 292;
  const g = c.getContext('2d');
  roundRect(g, 4, 4, 248, 284, 26);
  g.fillStyle = 'rgba(20,23,32,0.88)'; g.fill();
  g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.16)'; g.stroke();
  try { const img = await loadImage(layer.image); g.drawImage(img, 22, 18, 212, 212); } catch { /* ignore */ }
  g.fillStyle = '#f4f1ea'; g.font = '600 26px Inter, sans-serif'; g.textAlign = 'center';
  g.fillText(layer.name.length > 14 ? layer.name.slice(0, 13) + '…' : layer.name, 128, 266);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (old) { old.mesh.material.map.dispose(); old.mesh.material.map = tex; old.born = simTime; return; }
  const mesh = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
  mesh.renderOrder = 5;
  mesh.scale.setScalar(0.001);
  scene.add(mesh);
  tiles.set(layer.id, { mesh, born: simTime, leaving: null });
}
function removeTile(id) {
  const t = tiles.get(id);
  if (!t) return;
  scene.remove(t.mesh); t.mesh.material.map.dispose(); t.mesh.material.dispose();
  tiles.delete(id);
}
function clearTiles() { for (const id of [...tiles.keys()]) removeTile(id); }
function updateTiles(time) {
  const list = [...tiles.values()].filter((t) => !t.leaving);
  const n = Math.max(list.length, 10);
  let i = 0;
  for (const t of tiles.values()) {
    const m = t.mesh;
    if (t.leaving !== null) {
      const p = Math.min(1, (time - t.leaving) / 1.1);
      m.position.lerp(new THREE.Vector3(0, 0.4, 0), p * 0.25);
      m.scale.setScalar(Math.max(0.001, (1 - p) * m.scale.x));
      if (p >= 1) m.visible = false;
    } else {
      const a = (i / n) * Math.PI * 2 + time * 0.07;
      const r = 7.4;
      const target = new THREE.Vector3(Math.cos(a) * r, 3.2 + Math.sin(a * 2 + time * 0.6) * 0.7 + (i % 2) * 1.2, Math.sin(a) * r);
      m.position.lerp(target, 0.06);
      const age = time - t.born;
      m.scale.setScalar(age < 0.9 ? Math.max(0.001, easeOutBack(Math.min(1, age / 0.9))) : 1);
      i++;
    }
    m.quaternion.copy(camera.quaternion);
  }
}

// ================================================================== slicing + print job
const tmpV = new THREE.Vector3();

async function slice(list, token) {
  const N = list.length;
  const h = Math.min(0.6, Math.max(0.26, 9 / N));
  $('slice-count').textContent = N;
  $('slice-bar').style.width = '0%';
  const log = [];
  const items = [];
  for (let k = 0; k < N; k++) {
    if (token !== jobToken) return null;
    const l = list[k];
    let data = null;
    try { data = buildLayer(await loadImage(l.image), { size: PLATE, height: h, usedFill: l.usedFill }); } catch (e) { console.warn(e); }
    if (data) items.push(makeItem(l, data, h));
    log.push(`; layer ${String(k + 1).padStart(2, '0')}/${N}  ${l.name.padEnd(14).slice(0, 14)}  perimeters:${data ? data.path.length : 0}  infill:ok`);
    $('slice-log').textContent = log.slice(-3).join('\n');
    $('slice-bar').style.width = `${((k + 1) / N) * 100}%`;
    await new Promise((r) => setTimeout(r, 40));
  }
  items.forEach((it, k) => { it.k = k; it.mesh.position.y = k * h; it.line.position.y = k * h + h + 0.015; });
  return { items, h, k: 0, phase: 'outline', t: 0, total: items.length };
}

function makeItem(layer, data, h) {
  const plane = new THREE.Plane(new THREE.Vector3(-1, 0, -1).normalize(), 1e6);
  const topMat = new THREE.MeshStandardMaterial({
    map: data.texture, bumpMap: infillTex, bumpScale: 1.2, roughness: 0.58, metalness: 0,
    emissive: 0xffffff, emissiveMap: data.texture, emissiveIntensity: 0,
    clippingPlanes: [plane], clipShadows: true,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    vertexColors: true, bumpMap: beadTex, bumpScale: 2.2, roughness: 0.46, metalness: 0,
    emissive: data.dominantColor, emissiveIntensity: 0,
    clippingPlanes: [plane], clipShadows: true,
  });
  const mesh = new THREE.Mesh(data.geometry, [topMat, sideMat]);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.visible = false;
  stack.add(mesh);

  // outline path for the nozzle: travel moves + drawn moves
  const moves = [];
  let px = null, pz = null;
  for (const chain of data.path) {
    for (const [ax, ay, bx, by] of chain) {
      const x0 = ax, z0 = -ay, x1 = bx, z1 = -by;
      if (px !== null && (Math.abs(px - x0) > 1e-4 || Math.abs(pz - z0) > 1e-4)) moves.push({ x0: px, z0: pz, x1: x0, z1: z0, draw: false });
      moves.push({ x0, z0, x1, z1, draw: true });
      px = x1; pz = z1;
    }
  }
  let acc = 0, drawn = 0;
  const linePos = [];
  for (const m of moves) {
    m.len = Math.hypot(m.x1 - m.x0, m.z1 - m.z0) * (m.draw ? 1 : 0.3);
    m.start = acc; acc += m.len;
    m.drawnBefore = drawn;
    if (m.draw) { drawn++; linePos.push(m.x0, 0, m.z0, m.x1, 0, m.z1); }
  }
  const lineGeo = new LineSegmentsGeometry();
  if (linePos.length) lineGeo.setPositions(linePos);
  lineGeo.instanceCount = 0;
  const glow = data.dominantColor.clone().lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(3.2);
  const lineMat = new LineMaterial({ color: glow, linewidth: 3.2, transparent: true, toneMapped: false, depthTest: true });
  lineMat.resolution.set(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
  const line = new LineSegments2(lineGeo, lineMat);
  line.visible = false;
  line.renderOrder = 3;
  stack.add(line);

  // extents for the infill sweep (s = along sweep, t = across)
  const bb = data.geometry.boundingBox;
  const corners = [[bb.min.x, bb.min.z], [bb.max.x, bb.min.z], [bb.min.x, bb.max.z], [bb.max.x, bb.max.z]];
  const S = corners.map(([x, z]) => (x + z) / Math.SQRT2), T = corners.map(([x, z]) => (x - z) / Math.SQRT2);

  return {
    layer, data, mesh, topMat, sideMat, plane, line, lineGeo, moves, pathLen: acc, heat: 0, dim: 1,
    smin: Math.min(...S) - 0.05, smax: Math.max(...S) + 0.05, tmin: Math.min(...T), tmax: Math.max(...T),
  };
}

function disposeJob() {
  if (!job) return;
  for (const it of job.items) {
    stack.remove(it.mesh); stack.remove(it.line);
    it.data.geometry.dispose(); it.data.texture.dispose();
    it.topMat.dispose(); it.sideMat.dispose(); it.lineGeo.dispose(); it.line.material.dispose();
  }
  job = null;
}

function layerDurations(k, N) {
  const floor = N <= 8 ? 3.2 : N <= 16 ? 2.2 : 1.6;
  const d = Math.max(floor, 4.4 - k * 0.6);
  return { outline: d * 0.42, infill: d * 0.58 };
}

async function startPrint(list, { instant = false } = {}) {
  const token = ++jobToken;
  disposeJob();
  deselect();
  explode.target = 0; explode.value = 0;
  $('btn-explode').classList.remove('active');
  sound.init();
  setMode('slicing');
  for (const t of tiles.values()) t.leaving = simTime;
  const j = await slice(list, token);
  if (!j || token !== jobToken) return;
  job = j;
  clearTiles();
  if (!job.items.length) { toast('No drawings could be printed.'); return backToLobby(); }
  if (instant) return finishPrint(true);
  beginPrinting();
}

function beginPrinting() {
  job.k = 0; job.phase = 'outline'; job.t = 0;
  job.startedAt = performance.now();
  for (const it of job.items) {
    it.mesh.visible = false; it.heat = 0; it.plane.constant = 1e6;
    it.mesh.position.set(0, it.k * job.h, 0);
    it.line.visible = false; it.lineGeo.instanceCount = 0; it.line.material.opacity = 1;
  }
  rig.group.visible = true;
  rig.group.position.y = 0;
  $('hud-total').textContent = job.items.length;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.7;
  setMode('printing');
  flyTo(new THREE.Vector3(16.5, 10.5, 18.5), new THREE.Vector3(0, 1.4, 0), 2.4);
  startLayer(0);
}

function startLayer(k) {
  const it = job.items[k];
  job.k = k; job.phase = 'outline'; job.t = 0;
  job.dur = layerDurations(k, job.items.length);
  it.line.visible = it.moves.length > 0;
  it.lineGeo.instanceCount = 0;
  if (!it.moves.length) job.dur.outline = 0.01;
  $('hud-layer').textContent = k + 1;
  const nameEl = $('hud-name');
  nameEl.textContent = it.layer.name;
  nameEl.style.animation = 'none'; void nameEl.offsetWidth; nameEl.style.animation = '';
  if (!demo) sendMsg({ t: 'progress', index: k });
}

function finishLayer(it) {
  it.plane.constant = 1e6;
  it.mesh.visible = true;
  it.line.visible = false;
  it.heat = 1;
  sound.tick();
}

let lastNozzle = new THREE.Vector3();
function updatePrinting(dt, time) {
  const it = job.items[job.k];
  const yTop = it.k * job.h + job.h;
  job.t += dt;
  let nx, nz;

  if (job.phase === 'outline') {
    const u = Math.min(1, job.t / job.dur.outline);
    const target = u * it.pathLen;
    const mv = it.moves;
    let lo = 0, hi = mv.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (mv[mid].start <= target) lo = mid; else hi = mid - 1; }
    const m = mv[lo];
    if (m) {
      const f = m.len ? Math.min(1, (target - m.start) / m.len) : 1;
      nx = m.x0 + (m.x1 - m.x0) * f; nz = m.z0 + (m.z1 - m.z0) * f;
      it.lineGeo.instanceCount = m.drawnBefore + (m.draw && f > 0.5 ? 1 : 0);
    } else { nx = 0; nz = 0; }
    rig.setHeat(0.9);
    if (u >= 1) {
      it.lineGeo.instanceCount = it.moves.filter((q) => q.draw).length;
      job.phase = 'infill'; job.t = 0;
      it.mesh.visible = true;
      it.plane.constant = it.smin;
      it.heat = 1;
    }
  } else {
    const u = Math.min(1, job.t / job.dur.infill);
    const s = it.smin + (it.smax - it.smin) * u;
    it.plane.constant = s;
    const passes = 9;
    const w = (u * passes) % 1;
    const tri = w < 0.5 ? w * 2 : 2 - w * 2;
    const t = it.tmin + (it.tmax - it.tmin) * tri;
    nx = (s + t) / Math.SQRT2; nz = (s - t) / Math.SQRT2;
    it.heat = 1;
    it.line.material.opacity = 1 - u;
    rig.setHeat(1);
    if (u >= 1) {
      finishLayer(it);
      if (job.k + 1 >= job.items.length) return finishPrint(false);
      startLayer(job.k + 1);
    }
  }

  rig.setPosition(nx, yTop + 0.02, nz);
  const speed = tmpV.set(nx, yTop, nz).distanceTo(lastNozzle) / Math.max(dt, 1e-3);
  lastNozzle.set(nx, yTop, nz);
  sound.motor(speed);

  // camera gently rises with the print
  if (!flying) {
    const want = Math.max(1.4, yTop * 0.6 + 0.8);
    const dy = (want - controls.target.y) * Math.min(1, dt * 1.2);
    controls.target.y += dy; camera.position.y += dy;
  }

  // HUD
  const N = job.items.length;
  const frac = (job.k + (job.phase === 'infill' ? 0.42 + 0.58 * Math.min(1, job.t / job.dur.infill) : 0.42 * Math.min(1, job.t / job.dur.outline))) / N;
  $('hud-bar').style.width = `${frac * 100}%`;
  telemetry(time, speed, N);
}

let telT = 0;
function telemetry(time, speed, N) {
  if (time - telT < 0.25) return;
  telT = time;
  let left = 0;
  for (let k = job.k; k < N; k++) { const d = layerDurations(k, N); left += d.outline + d.infill; }
  left = Math.max(0, left - job.t);
  const temp = 214 + Math.sin(time * 1.7) * 1.2 + (Math.random() - 0.5) * 0.8;
  const mm = Math.min(250, Math.round(speed * 6));
  $('telemetry').innerHTML =
    `<div>Nozzle<b>${temp.toFixed(0)}°C</b></div><div>Bed<b>60°C</b></div>` +
    `<div>Speed<b>${String(mm).padStart(3, ' ')} mm/s</b></div><div>Time left<b>${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}</b></div>`;
}

async function finishPrint(instant) {
  const N = job.items.length;
  for (const it of job.items) { if (!it.mesh.visible || it.plane.constant < 1e5) { it.plane.constant = 1e6; it.mesh.visible = true; } it.line.visible = false; }
  sound.motor(0);
  rig.setHeat(0);
  if (!demo && server.phase === 'printing') { sendMsg({ t: 'progress', index: N - 1 }); sendMsg({ t: 'done' }); }
  setMode('finale');
  const people = new Set(job.items.map((it) => it.layer.name.toLowerCase())).size;
  $('finale-sub').textContent = `${people} ${people === 1 ? 'person' : 'people'} · ${N} ${N === 1 ? 'layer' : 'layers'} · one object`;
  const f = $('finale'); f.classList.remove('faded'); f.hidden = true; void f.offsetWidth; f.hidden = false;
  if (!instant) sound.chime();
  const H = N * job.h;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.9;
  if (instant) { rig.group.visible = false; }
  else {
    const y0 = rig.group.position.y;
    tween(1.8, (e) => { rig.group.position.y = y0 + e * 16; }).then(() => { rig.group.visible = false; });
  }
  const target = new THREE.Vector3(0, H * 0.46, 0);
  const dist = Math.max(26, H * 2.3 + 13);
  const dir = camera.position.clone().sub(controls.target).setY(0).normalize();
  const pos = target.clone().add(dir.multiplyScalar(dist * 0.86)).add(new THREE.Vector3(0, dist * 0.42, 0));
  if (instant) { camera.position.copy(pos); controls.target.copy(target); }
  else flyTo(pos, target, 2.8);
}

// ================================================================== finale interactions
const explode = { value: 0, target: 0 };
let selected = null;
const raycaster = new THREE.Raycaster();
let downAt = null;

function deselect() {
  selected = null;
  $('layer-card').hidden = true;
  if (mode === 'finale' && $('btn-spin').classList.contains('active')) controls.autoRotate = true;
}
function select(it) {
  selected = it;
  controls.autoRotate = false;
  $('lc-img').src = it.layer.image;
  $('lc-index').textContent = `Layer ${it.k + 1} of ${job.items.length}`;
  $('lc-name').textContent = it.layer.name;
  const card = $('layer-card');
  card.hidden = true; void card.offsetWidth; card.hidden = false;
  $('finale').classList.add('faded');
  sound.tick();
}

const canvasEl = renderer.domElement;
canvasEl.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvasEl.addEventListener('pointerup', (e) => {
  if (!downAt || mode !== 'finale' || !job) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 6) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(job.items.map((it) => it.mesh), false);
  const it = hits.length ? job.items.find((x) => x.mesh === hits[0].object) : null;
  if (!it || it === selected) return deselect();
  select(it);
});

function updateFinale(dt) {
  explode.value += (explode.target - explode.value) * Math.min(1, dt * 4);
  const side = tmpV.set(camera.position.x - controls.target.x, 0, camera.position.z - controls.target.z).normalize();
  for (const it of job.items) {
    const isSel = selected === it;
    it.sel = (it.sel || 0) + ((isSel ? 1 : 0) - (it.sel || 0)) * Math.min(1, dt * 7);
    const dimTarget = selected && !isSel ? 0.28 : 1;
    it.dim += (dimTarget - it.dim) * Math.min(1, dt * 6);
    it.topMat.color.setScalar(it.dim); it.sideMat.color.setScalar(it.dim);
    it.mesh.position.set(side.x * 2.2 * it.sel, it.k * job.h * (1 + explode.value * 1.9), side.z * 2.2 * it.sel);
    if (isSel) { it.topMat.emissiveIntensity = 0.05; }
  }
  if (selected) {
    const it = selected;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const p = it.mesh.position.clone().add(new THREE.Vector3(0, job.h / 2, 0)).add(right.multiplyScalar(PLATE * 0.42)).project(camera);
    const card = $('layer-card');
    const x = (p.x * 0.5 + 0.5) * window.innerWidth + 16;
    const y = (-p.y * 0.5 + 0.5) * window.innerHeight - card.offsetHeight / 2;
    card.style.transform = `translate(${Math.min(window.innerWidth - card.offsetWidth - 16, x)}px, ${Math.max(16, y)}px)`;
  }
}

$('btn-explode').onclick = () => {
  explode.target = explode.target ? 0 : 1;
  $('btn-explode').classList.toggle('active', !!explode.target);
  $('btn-explode').querySelector('span').textContent = explode.target ? 'Put back together' : 'Show layers';
  if (job) {
    const H = job.items.length * job.h * (1 + explode.target * 1.9);
    const target = new THREE.Vector3(0, H * 0.5, 0);
    const dir = camera.position.clone().sub(controls.target);
    const dist = Math.max(26, H * 1.9 + 12);
    flyTo(target.clone().add(dir.setLength(dist)), target, 1.4);
  }
};
$('btn-spin').onclick = () => {
  const on = !$('btn-spin').classList.contains('active');
  $('btn-spin').classList.toggle('active', on);
  controls.autoRotate = on && !selected;
};
$('btn-photo').onclick = () => {
  composer.render();
  download(renderer.domElement.toDataURL('image/png'), 'one-layer-each.png');
};
$('btn-stl').onclick = () => {
  if (!job) return;
  const MM_PER_UNIT = 8; // 10 units wide -> 80 mm
  const group = new THREE.Group();
  for (const it of job.items) { const m = new THREE.Mesh(it.data.geometry); m.position.y = it.k * job.h; group.add(m); }
  group.rotation.x = Math.PI / 2; // Y-up -> Z-up for slicers
  group.scale.setScalar(MM_PER_UNIT);
  group.updateMatrixWorld(true);
  const data = new STLExporter().parse(group, { binary: true });
  const url = URL.createObjectURL(new Blob([data], { type: 'model/stl' }));
  download(url, 'one-layer-each.stl');
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`STL saved · ${PLATE * MM_PER_UNIT} mm wide, ${(job.items.length * job.h * MM_PER_UNIT).toFixed(0)} mm tall`);
};
$('btn-replay').onclick = () => { if (job) { deselect(); explode.target = 0; explode.value = 0; $('btn-explode').classList.remove('active'); $('btn-explode').querySelector('span').textContent = 'Show layers'; beginPrinting(); } };
armButton($('btn-newround'), () => {
  if (demo) { demo = false; backToLobby(); return; }
  sendMsg({ t: 'reset' });
});

function backToLobby() {
  jobToken++;
  disposeJob();
  rig.group.visible = true;
  rig.group.position.y = 0;
  rig.setPosition(PLATE / 2 - 0.6, 0.9, PLATE / 2 - 0.6);
  rig.setHeat(0);
  sound.motor(0);
  controls.autoRotate = true; controls.autoRotateSpeed = 0.5;
  setMode('lobby');
  flyTo(LOBBY_CAM.pos, LOBBY_CAM.target, 2);
  for (const l of layers.values()) addTile(l);
  renderLobby();
}

$('skip').onclick = () => { if (mode === 'printing') finishPrint(false); };

// ================================================================== lobby UI
function renderLobby() {
  document.body.classList.toggle('phase-locked', server.phase === 'locked');
  document.body.classList.toggle('phase-open', server.phase === 'open');
  const count = layers.size;
  $('count').textContent = count;
  $('expected').textContent = server.expected;
  $('joined').textContent = `· ${Math.max(server.players, count)} joined`;
  $('layers-count').textContent = count;
  $('btn-print').disabled = count === 0;
  $('lock-label').textContent = server.phase === 'open' ? 'Lock' : 'Unlock';
  $('btn-lock').classList.toggle('on', server.phase !== 'open');
  $('timer-label').textContent = server.timerEnd ? 'Stop timer' : '2:00 timer';
  $('btn-timer').classList.toggle('on', !!server.timerEnd);
  if (server.joinUrl) $('join-url').textContent = server.joinUrl.replace(/^https?:\/\//, '');

  if (server.phase === 'locked') {
    $('hero-eyebrow').textContent = "Time's up";
    $('hero-title').innerHTML = 'All layers<br /><span class="grad">are in.</span>';
    $('hero-lede').textContent = `${count} ${count === 1 ? 'drawing' : 'drawings'}. Let's see what you made.`;
  } else {
    $('hero-eyebrow').textContent = 'Before we begin';
    $('hero-title').innerHTML = 'Everyone draws<br /><span class="grad">one layer.</span>';
    $('hero-lede').textContent = 'Scan the code, add your name, and draw anything you like. Nobody sees the full picture until the end.';
  }

  // stack meter: one bar per expected layer
  const meter = $('stack-meter');
  const slots = Math.max(server.expected, count);
  if (meter.children.length !== slots) { meter.innerHTML = ''; for (let i = 0; i < slots; i++) meter.appendChild(document.createElement('i')); }
  [...meter.children].forEach((el, i) => {
    const on = i < count;
    if (on && !el.classList.contains('on')) { el.style.setProperty('--c', PALETTE[(i * 3) % PALETTE.length].hex); el.style.width = `${60 + ((i * 37) % 40)}%`; }
    el.classList.toggle('on', on);
  });

  if (!$('drawer').hidden) renderDrawer();
}

function renderDrawer() {
  const grid = $('drawer-grid');
  grid.innerHTML = '';
  for (const l of [...layers.values()].sort((a, b) => b.at - a.at)) {
    const d = document.createElement('div'); d.className = 'thumb';
    const img = document.createElement('img'); img.src = l.image; img.alt = '';
    const s = document.createElement('span'); s.textContent = l.name;
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = `Remove ${l.name}'s drawing`;
    x.onclick = () => sendMsg({ t: 'remove', id: l.id });
    d.append(img, s, x); grid.appendChild(d);
  }
  if (!layers.size) grid.innerHTML = '<p class="dim">No drawings yet.</p>';
}

function feed(name, updated) {
  const li = document.createElement('li');
  const i = document.createElement('i'); i.style.setProperty('--c', PALETTE[Math.floor(Math.random() * PALETTE.length)].hex);
  const t = document.createElement('span');
  const b = document.createElement('b'); b.textContent = name;
  t.append(b, document.createTextNode(updated ? ' updated their layer' : ' added a layer'));
  li.append(i, t);
  const list = $('feed');
  list.prepend(li);
  while (list.children.length > 4) list.lastChild.remove();
  setTimeout(() => { li.style.opacity = 0; setTimeout(() => li.remove(), 1000); }, 7000);
}

setInterval(() => {
  const el = $('big-timer');
  if (!server.timerEnd || server.phase !== 'open') { el.hidden = true; return; }
  const left = Math.max(0, Math.round((server.timerEnd - Date.now()) / 1000));
  el.hidden = false;
  el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  el.classList.toggle('urgent', left <= 15);
}, 250);

// dock
$('btn-timer').onclick = () => sendMsg(server.timerEnd ? { t: 'timerCancel' } : { t: 'timer', seconds: Number(params.get('seconds')) || 120 });
$('btn-lock').onclick = () => sendMsg({ t: server.phase === 'open' ? 'lock' : 'unlock' });
$('btn-print').onclick = () => { sound.init(); if (layers.size) sendMsg({ t: 'print' }); };
$('btn-layers').onclick = () => { $('drawer').hidden = !$('drawer').hidden; if (!$('drawer').hidden) renderDrawer(); };
$('drawer-close').onclick = () => { $('drawer').hidden = true; };
$('btn-more').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
document.addEventListener('click', (e) => { if (!e.target.closest('.dock-more')) $('menu').hidden = true; });
$('m-demo').onclick = () => { $('menu').hidden = true; runDemo(); };
$('m-fullscreen').onclick = () => { $('menu').hidden = true; toggleFullscreen(); };
$('m-sound').onclick = () => { sound.setEnabled(!sound.enabled); $('m-sound').textContent = `Sound: ${sound.enabled ? 'on' : 'off'}`; };
armButton($('m-reset'), () => { $('menu').hidden = true; sendMsg({ t: 'reset' }); }, 'Click again to clear everything');

function runDemo() {
  demo = true;
  sound.init();
  startPrint(makeDemoDrawings(Number(params.get('demo')) || 28));
}

function armButton(btn, action, label) {
  let armed = null;
  const original = btn.innerHTML;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (armed) { clearTimeout(armed); armed = null; btn.classList.remove('armed'); btn.innerHTML = original; action(); return; }
    btn.classList.add('armed');
    if (label) btn.textContent = label; else toast('Click again to confirm');
    armed = setTimeout(() => { armed = null; btn.classList.remove('armed'); btn.innerHTML = original; }, 2500);
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
}
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'f') toggleFullscreen();
  else if (k === 'p' && mode === 'lobby') $('btn-print').click();
  else if (k === 'l' && mode === 'lobby') $('btn-lock').click();
  else if (k === 't' && mode === 'lobby') $('btn-timer').click();
  else if (k === 's' && mode === 'printing') $('skip').click();
  else if (k === 'e' && mode === 'finale') $('btn-explode').click();
  else if (k === 'escape') { deselect(); $('drawer').hidden = true; $('menu').hidden = true; }
});

function download(href, name) {
  const a = document.createElement('a'); a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
let toastT = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

// ================================================================== network
let ws = null, retry = 0;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: 'hello', role: 'host' })); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'state') {
      const prevPhase = server.phase;
      server = { ...server, ...m };
      // drop layers the server no longer has
      const ids = new Set(m.layers.map((l) => l.id));
      for (const id of [...layers.keys()]) if (!ids.has(id)) { layers.delete(id); removeTile(id); }
      if (!demo && (m.phase === 'printing' || m.phase === 'done') && mode === 'lobby' && m.order.length) {
        waitForLayers(m.order).then((list) => startPrint(list, { instant: m.phase === 'done' || prevPhase === m.phase }));
      }
      if (!demo && m.phase === 'open' && mode !== 'lobby' && prevPhase !== 'open') backToLobby();
      if (mode === 'lobby') renderLobby();
    }
    if (m.t === 'players') { server.players = m.count; if (mode === 'lobby') renderLobby(); }
    if (m.t === 'layer') {
      const existed = layers.has(m.layer.id);
      layers.set(m.layer.id, m.layer);
      if (mode === 'lobby') { addTile(m.layer); if (initialLoadDone) feed(m.layer.name, existed); renderLobby(); }
    }
    if (m.t === 'layerRemoved') { layers.delete(m.id); removeTile(m.id); renderLobby(); }
    if (m.t === 'reset') { layers.clear(); clearTiles(); if (!demo) backToLobby(); toast('All drawings cleared'); }
  };
  ws.onclose = () => setTimeout(connect, Math.min(4000, 400 * 2 ** retry++));
}
let initialLoadDone = false;
setTimeout(() => { initialLoadDone = true; }, 1500);
function sendMsg(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
async function waitForLayers(order) {
  for (let i = 0; i < 40 && !order.every((id) => layers.has(id)); i++) await new Promise((r) => setTimeout(r, 100));
  return order.map((id) => layers.get(id)).filter(Boolean);
}

// ================================================================== loop
const timer = new THREE.Timer();
timer.connect?.(document);
let slowFrames = 0;
function update(dt, time) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const p = Math.min(1, tw.t / tw.dur);
    tw.fn(tw.ease(p));
    if (p >= 1) { tweens.splice(i, 1); tw.res(); }
  }

  if (mode === 'lobby' || mode === 'slicing') {
    updateTiles(time);
    // idle printer: hover and "breathe"
    if (mode === 'lobby') { rig.setPosition(PLATE / 2 - 0.6 + Math.sin(time * 0.6) * 0.3, 0.9 + Math.sin(time * 1.3) * 0.05, PLATE / 2 - 0.6); rig.setHeat(0.25 + Math.sin(time * 2) * 0.1); }
  }
  if (job && mode === 'printing') updatePrinting(dt, time);
  if (job && mode === 'finale') updateFinale(dt);
  if (job) {
    for (const it of job.items) {
      if (it.heat > 0 && !(mode === 'printing' && job.items[job.k] === it)) it.heat = Math.max(0, it.heat - dt * 0.7);
      if (selected !== it) it.topMat.emissiveIntensity = it.heat * 0.7;
      it.sideMat.emissiveIntensity = it.heat * 0.9;
    }
  }

  // shift the scene sideways in the lobby so the text column stays clear
  view.x += (view.tx - view.x) * Math.min(1, dt * 2.5);
  view.y += (view.ty - view.y) * Math.min(1, dt * 2.5);
  controls.update(dt);
}
function render() {
  const w = window.innerWidth, h = window.innerHeight;
  if (job) for (const it of job.items) if (it.line.visible) it.line.material.resolution.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  if (Math.abs(view.x) > 0.001 || Math.abs(view.y) > 0.001) camera.setViewOffset(w, h, -w * view.x, h * view.y, w, h);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  composer.render();
}
function frame(ts) {
  timer.update(ts);
  const raw = timer.getDelta();
  const dt = Math.min(raw, 0.05);
  simTime += dt;
  update(dt, simTime);
  render();
  // drop resolution on slow machines so the animation stays smooth
  if (raw > 0.034 && raw < 1) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames > 90 && renderer.getPixelRatio() > 1) {
    renderer.setPixelRatio(1); stage.resize(); slowFrames = 0;
  }
  requestAnimationFrame(frame);
}

setMode('lobby');
renderLobby();
connect();
fetch('/config.json').then((r) => r.json()).then((c) => { server.joinUrl = c.joinUrl; server.expected = c.expected; renderLobby(); }).catch(() => {});
requestAnimationFrame(frame);
if (params.has('demo')) setTimeout(runDemo, 600);

// test hook
window.__ole = { advance: (sec) => { for (let t = 0; t < sec; t += 1 / 30) { simTime += 1 / 30; update(1 / 30, simTime); } }, get mode() { return mode; }, get job() { return job; }, finishPrint: () => finishPrint(false), select: (k) => job && select(job.items[k]), explode: () => $('btn-explode').click() };
