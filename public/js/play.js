import { PALETTE } from './palette.js';

// ------------------------------------------------------------------ storage
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
let pid = store.get('ole.pid') || randomId();
store.set('ole.pid', pid);

const $ = (id) => document.getElementById(id);
const screens = { join: $('screen-join'), draw: $('screen-draw'), status: $('screen-status') };

// ------------------------------------------------------------------ app state
const app = {
  name: store.get('ole.name') || '',
  joined: !!store.get('ole.name'),
  editing: false,
  server: { phase: 'open', hasLayer: false, timerEnd: null, position: null, total: 0, progress: -1 },
  lastImage: null,
  sending: false,
};

// ------------------------------------------------------------------ drawing pad
const SIZE = 768;
const pad = $('pad');
const ctx = pad.getContext('2d', { willReadFrequently: true });
const SIZES = [14, 30, 58];
let tool = 'brush';
let sizeIdx = 1;
let color = PALETTE[0].hex;
const ops = [];
let current = null;

function setDot() {
  const s = [10, 16, 24][sizeIdx];
  const btn = $('size');
  btn.style.setProperty('--s', `${s}px`);
  btn.style.setProperty('--c', tool === 'erase' ? '#fff' : color);
}

// palette
const paletteEl = $('palette');
PALETTE.forEach((p, i) => {
  const b = document.createElement('button');
  b.className = 'swatch'; b.type = 'button';
  b.style.setProperty('--c', p.hex);
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', p.name);
  b.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
  b.onclick = () => {
    color = p.hex;
    paletteEl.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-checked', s === b ? 'true' : 'false'));
    if (tool === 'erase') selectTool('brush');
    setDot();
  };
  paletteEl.appendChild(b);
});

function selectTool(t) {
  tool = t;
  document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  setDot();
}
document.querySelectorAll('.tool[data-tool]').forEach((b) => (b.onclick = () => selectTool(b.dataset.tool)));
$('size').onclick = () => { sizeIdx = (sizeIdx + 1) % SIZES.length; if (tool === 'fill') selectTool('brush'); setDot(); };
$('undo').onclick = () => { ops.pop(); redraw(); };
let clearArmed = null;
$('clear').onclick = () => {
  const b = $('clear');
  if (!clearArmed) {
    b.classList.add('danger');
    clearArmed = setTimeout(() => { b.classList.remove('danger'); clearArmed = null; }, 1800);
    toast('Tap again to clear');
    return;
  }
  clearTimeout(clearArmed); clearArmed = null; b.classList.remove('danger');
  ops.length = 0; redraw();
};
setDot();

function strokePath(c, pts) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) { c.lineTo(pts[0][0] + 0.01, pts[0][1]); return; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  c.lineTo(last[0], last[1]);
}
function applyStrokeStyle(c, op) {
  c.globalCompositeOperation = op.erase ? 'destination-out' : 'source-over';
  c.strokeStyle = op.color; c.lineWidth = op.size; c.lineCap = 'round'; c.lineJoin = 'round';
}
function drawOp(op) {
  if (op.type === 'stroke') {
    applyStrokeStyle(ctx, op); strokePath(ctx, op.points); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  } else if (op.type === 'fill') floodFill(op.x, op.y, op.color);
}
function redraw() {
  ctx.clearRect(0, 0, SIZE, SIZE);
  for (const op of ops) drawOp(op);
  updateDrawState();
}

function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function floodFill(sx, sy, hex) {
  sx = Math.max(0, Math.min(SIZE - 1, Math.round(sx)));
  sy = Math.max(0, Math.min(SIZE - 1, Math.round(sy)));
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const i0 = (sy * SIZE + sx) * 4;
  const seedClear = d[i0 + 3] < 128;
  const sr = d[i0], sg = d[i0 + 1], sb = d[i0 + 2];
  const [fr, fg, fb] = hexToRgb(hex);
  if (!seedClear && Math.abs(sr - fr) + Math.abs(sg - fg) + Math.abs(sb - fb) < 12) return;
  const match = (p) => {
    const i = p * 4;
    if (seedClear) return d[i + 3] < 128;
    return d[i + 3] >= 128 && Math.abs(d[i] - sr) + Math.abs(d[i + 1] - sg) + Math.abs(d[i + 2] - sb) < 110;
  };
  const seen = new Uint8Array(SIZE * SIZE);
  const stack = [sy * SIZE + sx];
  while (stack.length) {
    const p = stack.pop();
    if (seen[p] || !match(p)) continue;
    let x = p % SIZE; const y = (p - x) / SIZE;
    let l = x; while (l > 0 && !seen[y * SIZE + l - 1] && match(y * SIZE + l - 1)) l--;
    let r = x; while (r < SIZE - 1 && !seen[y * SIZE + r + 1] && match(y * SIZE + r + 1)) r++;
    for (x = l; x <= r; x++) {
      const q = y * SIZE + x; seen[q] = 1;
      const i = q * 4; d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
      if (y > 0 && !seen[q - SIZE]) stack.push(q - SIZE);
      if (y < SIZE - 1 && !seen[q + SIZE]) stack.push(q + SIZE);
    }
  }
  ctx.putImageData(img, 0, 0);
}

function toCanvas(e) {
  const r = pad.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE];
}
let activePointer = null;
pad.addEventListener('pointerdown', (e) => {
  if (activePointer !== null) return;
  e.preventDefault();
  const pt = toCanvas(e);
  if (tool === 'fill') {
    const op = { type: 'fill', x: pt[0], y: pt[1], color };
    ops.push(op); drawOp(op); updateDrawState();
    return;
  }
  activePointer = e.pointerId;
  pad.setPointerCapture(e.pointerId);
  current = { type: 'stroke', color, size: SIZES[sizeIdx] * (tool === 'erase' ? 1.4 : 1), erase: tool === 'erase', points: [pt] };
  ops.push(current);
  applyStrokeStyle(ctx, current);
  ctx.beginPath(); ctx.moveTo(pt[0], pt[1]); ctx.lineTo(pt[0] + 0.01, pt[1]); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  $('empty-hint').style.opacity = 0;
});
pad.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointer || !current) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs) {
    const pt = toCanvas(ev);
    const pts = current.points;
    const prev = pts[pts.length - 1];
    if (Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) < 2) continue;
    pts.push(pt);
    // incremental smooth segment
    applyStrokeStyle(ctx, current);
    ctx.beginPath();
    if (pts.length === 2) { ctx.moveTo(prev[0], prev[1]); ctx.lineTo((prev[0] + pt[0]) / 2, (prev[1] + pt[1]) / 2); }
    else {
      const p0 = pts[pts.length - 3];
      ctx.moveTo((p0[0] + prev[0]) / 2, (p0[1] + prev[1]) / 2);
      ctx.quadraticCurveTo(prev[0], prev[1], (prev[0] + pt[0]) / 2, (prev[1] + pt[1]) / 2);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
});
const endStroke = (e) => {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  if (current) { current = null; redraw(); }
};
pad.addEventListener('pointerup', endStroke);
pad.addEventListener('pointercancel', endStroke);

function inkPixels() {
  const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] > 100) n++;
  return n;
}
function updateDrawState() {
  const ink = ops.length ? inkPixels() : 0;
  $('send').disabled = ink < 30 || app.sending;
  $('empty-hint').style.opacity = ops.length ? 0 : 1;
}

function exportImage() {
  const out = document.createElement('canvas');
  out.width = out.height = 512;
  const c = out.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(pad, 0, 0, 512, 512);
  return out.toDataURL('image/png');
}

// ------------------------------------------------------------------ layout
function layout() {
  if (screens.draw.hidden) return;
  const others = ['.draw-head', '.prompt', '#palette', '.tools', '#send']
    .map((s) => document.querySelector(s).getBoundingClientRect().height)
    .reduce((a, b) => a + b, 0);
  const cs = getComputedStyle(screens.draw);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const gaps = 12 * 5 + 4;
  const avail = window.innerHeight - others - padY - gaps;
  const size = Math.max(200, Math.min(window.innerWidth - 32, 520, avail));
  document.documentElement.style.setProperty('--pad', `${Math.floor(size)}px`);
}
window.addEventListener('resize', layout);

// ------------------------------------------------------------------ network
let ws = null;
let retry = 0;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0; $('net').hidden = true;
    ws.send(JSON.stringify({ t: 'hello', role: 'player', pid, name: app.name }));
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'welcome' && m.pid !== pid) { pid = m.pid; store.set('ole.pid', pid); }
    if (m.t === 'you') {
      const prev = app.server;
      app.server = m;
      if (m.phase === 'printing' && prev.progress !== m.progress && m.position && m.progress === m.position - 1) buzz();
      render();
    }
    if (m.t === 'received') { app.sending = false; app.editing = false; toast('Layer sent'); render(); }
    if (m.t === 'error') { app.sending = false; $('send').textContent = 'Send my layer'; updateDrawState(); toast(m.message); }
    if (m.t === 'removed') { app.editing = true; toast('The host removed your drawing. Try another one?'); render(); }
    if (m.t === 'reset') { ops.length = 0; redraw(); app.editing = false; app.lastImage = null; toast('New round started'); render(); }
  };
  ws.onclose = () => {
    $('net').hidden = false;
    setTimeout(connect, Math.min(4000, 400 * 2 ** retry++));
  };
}
function sendMsg(m) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; }

$('send').onclick = () => {
  if (!app.name) { show('join'); return; }
  const image = exportImage();
  app.lastImage = image;
  app.sending = true;
  $('send').disabled = true; $('send').textContent = 'Sending…';
  if (!sendMsg({ t: 'submit', name: app.name, image, usedFill: ops.some((o) => o.type === 'fill') })) {
    app.sending = false; $('send').textContent = 'Send my layer'; updateDrawState();
    toast('Not connected yet. Try again in a second.');
  }
};

// ------------------------------------------------------------------ join
$('name').value = app.name;
$('join-form').onsubmit = (e) => {
  e.preventDefault();
  const n = $('name').value.trim().slice(0, 24);
  if (!n) return;
  app.name = n; app.joined = true;
  store.set('ole.name', n);
  $('name').blur();
  sendMsg({ t: 'hello', role: 'player', pid, name: n });
  if (app.server.phase === 'open' && app.server.hasLayer) app.editing = true;
  render();
};
$('rename').onclick = () => { app.joined = false; render(); setTimeout(() => $('name').focus(), 50); };

// ------------------------------------------------------------------ screens
function show(which) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== which;
  if (which === 'draw') { $('me-name').textContent = app.name; $('send').textContent = app.sending ? 'Sending…' : (app.server.hasLayer ? 'Update my layer' : 'Send my layer'); requestAnimationFrame(layout); updateDrawState(); }
}

function setStatus({ visual = '', eyebrow = '', title = '', body = '', button = null, meter = null, hot = false }) {
  $('status-visual').innerHTML = '';
  if (visual instanceof Node) $('status-visual').appendChild(visual);
  $('status-eyebrow').textContent = eyebrow;
  $('status-title').textContent = title;
  $('status-body').textContent = body;
  document.querySelector('.status').classList.toggle('hot', hot);
  const btn = $('status-btn');
  btn.hidden = !button;
  if (button) { btn.textContent = button.label; btn.onclick = button.onClick; }
  $('meter').hidden = meter === null;
  if (meter !== null) $('meter-fill').style.width = `${Math.round(meter * 100)}%`;
}
function slabVisual() {
  const d = document.createElement('div');
  d.className = 'slab';
  if (app.lastImage) d.style.backgroundImage = `url(${app.lastImage})`;
  return d;
}
function lockVisual() {
  const d = document.createElement('div');
  d.className = 'lock-icon';
  d.innerHTML = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  return d;
}
function numberVisual(n, label) {
  const d = document.createElement('div');
  d.className = 'big-number';
  d.textContent = `#${n}`;
  const s = document.createElement('small'); s.textContent = label; d.appendChild(s);
  return d;
}

function render() {
  const s = app.server;
  if (!app.joined) return show('join');

  if (s.phase === 'open') {
    if (!s.hasLayer || app.editing) return show('draw');
    show('status');
    return setStatus({
      visual: slabVisual(), eyebrow: 'Layer received', title: 'Nice. Keep it a secret.',
      body: 'Nobody sees the full picture until the end. Watch the big screen.',
      button: { label: 'Change my drawing', onClick: () => { app.editing = true; render(); } },
    });
  }

  show('status');
  if (s.phase === 'locked') {
    return setStatus(s.hasLayer
      ? { visual: slabVisual(), eyebrow: "Time's up", title: 'All layers are in.', body: 'Eyes on the big screen. Something is about to happen.' }
      : { visual: lockVisual(), eyebrow: "Time's up", title: 'Drawing is closed.', body: 'Eyes on the big screen. Something is about to happen.' });
  }

  const total = s.total || 0;
  const cur = s.progress; // 0-based layer being printed
  const pos = s.position; // 1-based
  if (s.phase === 'printing') {
    const meter = total ? Math.max(0, cur + 1) / total : 0;
    if (!pos) return setStatus({ visual: lockVisual(), eyebrow: 'Now on the big screen', title: 'Look up!', body: cur >= 0 ? `Layer ${cur + 1} of ${total}` : 'Getting ready…', meter });
    if (cur < 0) return setStatus({ visual: numberVisual(pos, 'your layer'), eyebrow: 'Look up!', title: 'Getting ready…', body: `Yours is layer #${pos} of ${total}. Watch closely.`, meter });
    if (cur === pos - 1) return setStatus({ visual: numberVisual(pos, 'your layer'), eyebrow: 'Right now', title: "That's YOUR layer!", body: 'Look at the big screen.', meter, hot: true });
    if (cur === pos - 2) return setStatus({ visual: numberVisual(pos, 'your layer'), eyebrow: `Layer ${cur + 1} of ${total}`, title: "You're next!", body: 'Get ready to point at the screen.', meter });
    if (cur < pos - 1) return setStatus({ visual: numberVisual(pos, 'your layer'), eyebrow: `Layer ${cur + 1} of ${total}`, title: 'Watch the big screen.', body: `Yours is #${pos}. ${pos - cur - 1} to go.`, meter });
    return setStatus({ visual: numberVisual(pos, 'your layer'), eyebrow: `Layer ${cur + 1} of ${total}`, title: 'Your layer is in.', body: 'Keep watching. It is still growing.', meter });
  }

  if (s.phase === 'done') {
    return setStatus(pos
      ? { visual: numberVisual(pos, `of ${total} layers`), eyebrow: 'Complete', title: `You made layer #${pos}.`, body: 'Look up at what you built together.' }
      : { visual: lockVisual(), eyebrow: 'Complete', title: 'Look up!', body: 'See what everyone built together.' });
  }
}

// ------------------------------------------------------------------ timer
setInterval(() => {
  const el = $('timer');
  const end = app.server.timerEnd;
  if (!end || app.server.phase !== 'open') { el.hidden = true; return; }
  const left = Math.max(0, Math.round((end - Date.now()) / 1000));
  el.hidden = false;
  el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  el.classList.toggle('urgent', left <= 15);
}, 250);

// ------------------------------------------------------------------ misc
let toastT = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}
function buzz() { try { navigator.vibrate && navigator.vibrate([120, 60, 120, 60, 240]); } catch { /* not supported */ } }

// stop iOS rubber-banding while drawing
document.addEventListener('touchmove', (e) => { if (e.target === pad) e.preventDefault(); }, { passive: false });

render();
connect();
