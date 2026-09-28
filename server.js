// One Layer Each — game server
// Serves the host (projector) page and the player (phone) page, and relays
// drawings between them over WebSockets. Everything runs on your laptop;
// phones connect over the same Wi-Fi.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MODULES = path.join(ROOT, 'node_modules');
const DATA_DIR = path.join(ROOT, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'session.json');

const PORT = Number(process.env.PORT || 3000);
const EXPECTED = Number(process.env.PLAYERS || 28);
const MAX_IMAGE_BYTES = 2_000_000;
const MAX_NAME = 24;

// ---------------------------------------------------------------- join URL
function lanAddress() {
  const candidates = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      let score = 0;
      if (a.address.startsWith('192.168.')) score += 3;
      else if (a.address.startsWith('10.')) score += 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 1;
      if (/^(en|eth|wl|wi-?fi|wlan)/i.test(name)) score += 2;
      if (/(vbox|vmnet|docker|veth|virtual|utun|tailscale|zt)/i.test(name)) score -= 5;
      candidates.push({ address: a.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address || 'localhost';
}
const JOIN_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://${lanAddress()}:${PORT}`).replace(/\/$/, '');

// ---------------------------------------------------------------- state
const state = {
  phase: 'open', // open | locked | printing | done
  timerEnd: null,
  order: [], // layer ids in print order (shuffled at print time)
  progress: -1, // index of layer currently printing
};
const layers = new Map(); // playerId -> { id, name, image, usedFill, at }

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    for (const l of saved.layers || []) layers.set(l.id, l);
    if (['open', 'locked', 'printing', 'done'].includes(saved.phase)) state.phase = saved.phase;
    state.order = (saved.order || []).filter((id) => layers.has(id));
    if (state.phase === 'printing') state.phase = 'done';
    console.log(`  Restored ${layers.size} layer(s) from the last session.`);
  } catch { /* fresh start */ }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SAVE_FILE, JSON.stringify({ phase: state.phase, order: state.order, layers: [...layers.values()] }));
    } catch (e) { console.warn('Could not save session:', e.message); }
  }, 300);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- static files
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': file.includes('node_modules') ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}
function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, decodeURIComponent(rel)));
  return p.startsWith(base + path.sep) ? p : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/' || p === '/play') return sendFile(res, path.join(PUBLIC, 'play.html'));
  if (p === '/host') return sendFile(res, path.join(PUBLIC, 'host.html'));
  if (p === '/qr.svg') {
    const svg = await QRCode.toString(JOIN_URL, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0b0d12', light: '#00000000' } });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
    return res.end(svg);
  }
  if (p === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ joinUrl: JOIN_URL, expected: EXPECTED }));
  }
  let file = null;
  if (p.startsWith('/static/')) file = safeJoin(PUBLIC, p.slice(8));
  else if (p.startsWith('/vendor/three/')) file = safeJoin(path.join(MODULES, 'three'), p.slice(14));
  else if (p.startsWith('/vendor/fonts/')) file = safeJoin(path.join(MODULES, '@fontsource'), p.slice(14));
  if (file) return sendFile(res, file);
  res.writeHead(404); res.end('Not found');
});

// ---------------------------------------------------------------- websockets
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_IMAGE_BYTES + 10_000 });
const hosts = new Set();
const players = new Map(); // ws -> { pid, name }

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const meta = (l) => ({ id: l.id, name: l.name, at: l.at });

function playerCount() {
  const ids = new Set();
  for (const p of players.values()) if (p.pid) ids.add(p.pid);
  for (const id of layers.keys()) ids.add(id);
  return ids.size;
}

function hostState() {
  return {
    t: 'state', phase: state.phase, timerEnd: state.timerEnd, expected: EXPECTED, joinUrl: JOIN_URL,
    players: playerCount(), layers: [...layers.values()].map(meta), order: state.order, progress: state.progress,
  };
}
function playerState(pid) {
  const idx = state.order.indexOf(pid);
  return {
    t: 'you', phase: state.phase, timerEnd: state.timerEnd, hasLayer: layers.has(pid),
    position: idx >= 0 ? idx + 1 : null, total: state.order.length || layers.size, progress: state.progress,
  };
}
function broadcastHosts(msg) { for (const h of hosts) send(h, msg); }
function broadcastPlayers() { for (const [ws, p] of players) send(ws, playerState(p.pid)); }
function broadcastAll() { broadcastHosts(hostState()); broadcastPlayers(); }

let timerHandle = null;
function setPhase(phase) {
  state.phase = phase;
  if (phase !== 'open') { state.timerEnd = null; clearTimeout(timerHandle); }
  save();
  broadcastAll();
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'hello' && m.role === 'host') {
      hosts.add(ws); players.delete(ws);
      send(ws, hostState());
      for (const l of layers.values()) send(ws, { t: 'layer', layer: l });
      return;
    }
    if (m.t === 'hello' && m.role === 'player') {
      const pid = String(m.pid || '').slice(0, 64) || crypto.randomUUID();
      players.set(ws, { pid, name: String(m.name || '').slice(0, MAX_NAME) });
      send(ws, { t: 'welcome', pid });
      send(ws, playerState(pid));
      broadcastHosts({ t: 'players', count: playerCount() });
      return;
    }

    // ---- player actions
    if (players.has(ws)) {
      const p = players.get(ws);
      if (m.t === 'submit') {
        if (state.phase !== 'open') return send(ws, { t: 'error', message: 'Drawing time is over.' });
        const name = String(m.name || '').trim().slice(0, MAX_NAME);
        const image = String(m.image || '');
        if (!name) return send(ws, { t: 'error', message: 'Please add your name.' });
        if (!image.startsWith('data:image/png;base64,') || image.length > MAX_IMAGE_BYTES) return send(ws, { t: 'error', message: 'That drawing could not be sent. Try again.' });
        const layer = { id: p.pid, name, image, usedFill: !!m.usedFill, at: Date.now() };
        p.name = name;
        layers.set(p.pid, layer);
        save();
        send(ws, { t: 'received' });
        send(ws, playerState(p.pid));
        broadcastHosts({ t: 'layer', layer });
        broadcastHosts({ t: 'state', ...hostState() });
      }
      return;
    }

    // ---- host actions
    if (!hosts.has(ws)) return;
    switch (m.t) {
      case 'lock': if (state.phase === 'open') setPhase('locked'); break;
      case 'unlock': if (state.phase === 'locked' || state.phase === 'done') { state.order = []; state.progress = -1; setPhase('open'); } break;
      case 'timer': {
        if (state.phase !== 'open') break;
        const secs = Math.max(10, Math.min(900, Number(m.seconds) || 120));
        state.timerEnd = Date.now() + secs * 1000;
        clearTimeout(timerHandle);
        timerHandle = setTimeout(() => { if (state.phase === 'open') setPhase('locked'); }, secs * 1000 + 500);
        broadcastAll();
        break;
      }
      case 'timerCancel': state.timerEnd = null; clearTimeout(timerHandle); broadcastAll(); break;
      case 'print': {
        if (!layers.size) break;
        state.order = shuffle([...layers.keys()]);
        state.progress = -1;
        setPhase('printing');
        break;
      }
      case 'progress': {
        state.progress = Math.max(-1, Math.min(state.order.length, Number(m.index)));
        for (const [pws, p] of players) send(pws, playerState(p.pid));
        break;
      }
      case 'done': if (state.phase === 'printing') { state.progress = state.order.length; setPhase('done'); } break;
      case 'remove': {
        const id = String(m.id);
        if (layers.delete(id)) {
          state.order = state.order.filter((x) => x !== id);
          save();
          broadcastHosts({ t: 'layerRemoved', id });
          for (const [pws, p] of players) if (p.pid === id) send(pws, { t: 'removed' });
          broadcastAll();
        }
        break;
      }
      case 'reset': {
        layers.clear(); state.order = []; state.progress = -1; state.timerEnd = null;
        clearTimeout(timerHandle);
        state.phase = 'open';
        save();
        broadcastHosts({ t: 'reset' });
        for (const [pws] of players) send(pws, { t: 'reset' });
        broadcastAll();
        break;
      }
    }
  });

  ws.on('close', () => {
    hosts.delete(ws);
    if (players.delete(ws)) broadcastHosts({ t: 'players', count: playerCount() });
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 20_000);

load();
server.listen(PORT, '0.0.0.0', () => {
  const line = '─'.repeat(58);
  console.log(`\n  ${line}`);
  console.log('   ONE LAYER EACH is running');
  console.log(`  ${line}`);
  console.log(`   Projector screen:  http://localhost:${PORT}/host`);
  console.log(`   Players join at:   ${JOIN_URL}`);
  console.log(`  ${line}`);
  console.log('   Phones must be on the same Wi-Fi as this laptop.');
  console.log('   Stop the game with Ctrl+C.\n');
});
