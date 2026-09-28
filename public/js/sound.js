// A tiny synthesized "stepper motor" hum plus a finishing chime.
export class PrinterSound {
  constructor() { this.enabled = true; this.ctx = null; }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.master.connect(c.destination);

    this.motorGain = c.createGain(); this.motorGain.gain.value = 0;
    const filter = c.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 900; filter.Q.value = 0.8;
    this.osc = c.createOscillator(); this.osc.type = 'square'; this.osc.frequency.value = 220;
    this.osc2 = c.createOscillator(); this.osc2.type = 'sawtooth'; this.osc2.frequency.value = 331;
    const g2 = c.createGain(); g2.gain.value = 0.4;
    this.osc.connect(filter); this.osc2.connect(g2).connect(filter);
    filter.connect(this.motorGain).connect(this.master);
    this.osc.start(); this.osc2.start();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  motor(speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = Math.min(1100, 140 + speed * 36);
    this.osc.frequency.setTargetAtTime(f, t, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 1.5, t, 0.03);
    this.motorGain.gain.setTargetAtTime(speed > 0.3 ? 0.028 : 0, t, 0.05);
  }

  chime() {
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + 0.05;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = t0 + i * 0.11;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 1.7);
    });
  }

  tick() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = 1760;
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.13);
  }
}
