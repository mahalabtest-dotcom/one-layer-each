// Fake drawings for rehearsing the reveal without any phones.
import { PALETTE } from './palette.js';

const NAMES = ['Maha', 'Omar', 'Layla', 'Yusuf', 'Sara', 'Khalid', 'Noor', 'Ahmed', 'Priya', 'Daniel', 'Aisha', 'Hamad',
  'Fatima', 'Leo', 'Mariam', 'Ravi', 'Hessa', 'Tom', 'Reem', 'Ali', 'Chen', 'Dana', 'Zayed', 'Emma', 'Salma', 'Faisal', 'Ines', 'Rashid'];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const colors = () => PALETTE.map((p) => p.hex);

function star(c, r, spikes = 5) {
  c.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
}
function heart(c, r) {
  c.beginPath();
  c.moveTo(0, r * 0.9);
  c.bezierCurveTo(-r * 1.4, -r * 0.1, -r * 0.6, -r * 1.1, 0, -r * 0.4);
  c.bezierCurveTo(r * 0.6, -r * 1.1, r * 1.4, -r * 0.1, 0, r * 0.9);
  c.closePath();
}
function blob(c, r) {
  c.beginPath();
  const n = 9, pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const rr = r * rnd(0.65, 1.1); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (i === 0) c.moveTo(m[0], m[1]); else c.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  const p = pts[0], q = pts[1];
  c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  c.closePath();
}

const SHAPES = [
  // filled star
  (c, r, col) => { star(c, r, pick([5, 6, 7])); c.fillStyle = col[0]; c.fill(); },
  // heart outline only (gets auto-filled)
  (c, r, col) => { heart(c, r); c.strokeStyle = col[0]; c.lineWidth = 20; c.stroke(); },
  // donut drawn with the bucket (hole stays a hole)
  (c, r, col) => { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.arc(0, 0, r * 0.45, 0, Math.PI * 2, true); c.fillStyle = col[0]; c.fill('evenodd'); return { usedFill: true }; },
  // smiley
  (c, r, col) => {
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fillStyle = col[0]; c.fill();
    c.fillStyle = col[1]; c.beginPath(); c.arc(-r * 0.35, -r * 0.25, r * 0.13, 0, 7); c.arc(r * 0.35, -r * 0.25, r * 0.13, 0, 7); c.fill();
    c.strokeStyle = col[1]; c.lineWidth = r * 0.12; c.lineCap = 'round'; c.beginPath(); c.arc(0, r * 0.05, r * 0.5, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke();
  },
  // blob
  (c, r, col) => { blob(c, r); c.fillStyle = col[0]; c.fill(); },
  // squiggle line
  (c, r, col) => {
    c.strokeStyle = col[0]; c.lineWidth = 34; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(-r, 0);
    for (let x = -r; x <= r; x += 8) c.lineTo(x, Math.sin(x / r * Math.PI * 2) * r * 0.45);
    c.stroke();
  },
  // lightning bolt
  (c, r, col) => {
    c.beginPath(); c.moveTo(r * 0.2, -r); c.lineTo(-r * 0.6, r * 0.1); c.lineTo(-r * 0.05, r * 0.1); c.lineTo(-r * 0.3, r); c.lineTo(r * 0.6, -r * 0.2); c.lineTo(r * 0.05, -r * 0.2); c.closePath();
    c.fillStyle = col[0]; c.fill();
  },
  // flower
  (c, r, col) => {
    c.fillStyle = col[0];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; c.beginPath(); c.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.42, 0, 7); c.fill(); }
    c.fillStyle = col[1]; c.beginPath(); c.arc(0, 0, r * 0.38, 0, 7); c.fill();
  },
  // house outline
  (c, r, col) => {
    c.strokeStyle = col[0]; c.lineWidth = 22; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(-r * 0.8, -r * 0.1); c.lineTo(0, -r); c.lineTo(r * 0.8, -r * 0.1); c.lineTo(r * 0.8, r * 0.9); c.lineTo(-r * 0.8, r * 0.9); c.closePath(); c.stroke();
  },
  // crescent moon
  (c, r, col) => {
    c.fillStyle = col[0]; c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill();
    c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(r * 0.45, -r * 0.2, r * 0.85, 0, 7); c.fill();
    c.globalCompositeOperation = 'source-over';
  },
  // fish
  (c, r, col) => {
    c.fillStyle = col[0];
    c.beginPath(); c.ellipse(-r * 0.1, 0, r * 0.75, r * 0.45, 0, 0, 7); c.fill();
    c.beginPath(); c.moveTo(r * 0.5, 0); c.lineTo(r, -r * 0.45); c.lineTo(r, r * 0.45); c.closePath(); c.fill();
    c.fillStyle = col[1]; c.beginPath(); c.arc(-r * 0.5, -r * 0.08, r * 0.09, 0, 7); c.fill();
  },
  // cloud
  (c, r, col) => {
    c.fillStyle = col[0];
    [[-0.5, 0.15, 0.4], [0, -0.15, 0.55], [0.5, 0.15, 0.4], [0, 0.25, 0.4]].forEach(([x, y, s]) => { c.beginPath(); c.arc(x * r, y * r, s * r, 0, 7); c.fill(); });
  },
  // spiral scribble
  (c, r, col) => {
    c.strokeStyle = col[0]; c.lineWidth = 26; c.lineCap = 'round'; c.beginPath();
    for (let t = 0; t < Math.PI * 5; t += 0.1) { const rr = (t / (Math.PI * 5)) * r; c.lineTo(Math.cos(t) * rr, Math.sin(t) * rr); }
    c.stroke();
  },
  // triangle with stripes
  (c, r, col) => {
    c.beginPath(); c.moveTo(0, -r); c.lineTo(r, r * 0.8); c.lineTo(-r, r * 0.8); c.closePath(); c.fillStyle = col[0]; c.fill();
    c.save(); c.clip(); c.fillStyle = col[1];
    for (let y = -r; y < r; y += r * 0.4) c.fillRect(-r, y, 2 * r, r * 0.16);
    c.restore();
  },
];

export function makeDemoDrawings(count = 28) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const c = cv.getContext('2d');
    const r = rnd(110, 205);
    c.translate(256 + rnd(-50, 50), 256 + rnd(-50, 50));
    c.rotate(rnd(-0.5, 0.5));
    const cols = colors().sort(() => Math.random() - 0.5);
    const meta = SHAPES[i % SHAPES.length](c, r, cols) || {};
    out.push({ id: `demo-${i}`, name: NAMES[i % NAMES.length], image: cv.toDataURL('image/png'), usedFill: !!meta.usedFill });
  }
  return out.sort(() => Math.random() - 0.5);
}
