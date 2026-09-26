'use strict';
// Every sound in the game is synthesized with WebAudio — no audio assets.

const Sfx = {
  ctx: null, master: null, noiseBuf: null, muted: false,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Player engine: two detuned oscillators through a lowpass.
    this.engA = ctx.createOscillator(); this.engA.type = 'sawtooth';
    this.engB = ctx.createOscillator(); this.engB.type = 'square';
    this.engF = ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 500;
    this.engG = ctx.createGain(); this.engG.gain.value = 0;
    this.engA.connect(this.engF); this.engB.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.master);
    this.engA.start(); this.engB.start();

    // Police siren.
    this.sirO = ctx.createOscillator(); this.sirO.type = 'triangle';
    this.sirG = ctx.createGain(); this.sirG.gain.value = 0;
    this.sirO.connect(this.sirG); this.sirG.connect(this.master);
    this.sirO.start();

    // Wind while flying.
    this.windS = ctx.createBufferSource(); this.windS.buffer = this.noiseBuf; this.windS.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.7;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    this.windS.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    this.windS.start();
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
  },

  vol(x, y) {
    if (x === undefined) return 1;
    return clamp(1 - dist(x, y, G.cam.x, G.cam.y) / 1700, 0, 1);
  },

  noise({ dur = 0.2, type = 'lowpass', freq = 1000, freqEnd = 0, q = 1, gain = 0.5, attack = 0.003, rate = 1, x, y }) {
    if (!this.ctx || this.muted) return;
    const v = gain * this.vol(x, y);
    if (v < 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  },

  tone({ freq = 440, freqEnd = 0, dur = 0.2, type = 'sine', gain = 0.3, x, y, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const v = gain * this.vol(x, y);
    if (v < 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },

  shot(kind, x, y) {
    switch (kind) {
      case 'pistol':
        this.noise({ dur: 0.2, type: 'bandpass', freq: 2200, freqEnd: 300, q: 0.7, gain: 0.7, x, y });
        this.tone({ freq: 200, freqEnd: 50, dur: 0.1, gain: 0.35, x, y });
        break;
      case 'uzi':
        this.noise({ dur: 0.09, type: 'bandpass', freq: 2600, freqEnd: 500, q: 0.8, gain: 0.5, x, y });
        this.tone({ freq: 160, freqEnd: 60, dur: 0.05, gain: 0.25, x, y });
        break;
      case 'shotgun':
        this.noise({ dur: 0.45, type: 'lowpass', freq: 3000, freqEnd: 150, gain: 0.95, x, y });
        this.tone({ freq: 120, freqEnd: 35, dur: 0.2, gain: 0.5, x, y });
        break;
      case 'flamer':
        this.noise({ dur: 0.12, type: 'lowpass', freq: 700, gain: 0.12, x, y });
        break;
      case 'rocket':
        this.noise({ dur: 0.7, type: 'bandpass', freq: 400, freqEnd: 2400, q: 1.2, gain: 0.6, x, y });
        break;
      case 'throw':
        this.tone({ freq: 500, freqEnd: 250, dur: 0.12, type: 'triangle', gain: 0.15, x, y });
        break;
    }
  },

  explosion(x, y) {
    this.noise({ dur: 1.6, type: 'lowpass', freq: 1400, freqEnd: 60, gain: 1.3, attack: 0.005, x, y });
    this.tone({ freq: 95, freqEnd: 28, dur: 0.8, gain: 0.9, x, y });
  },
  crash(x, y, s = 1) {
    this.noise({ dur: 0.25, type: 'bandpass', freq: 900, freqEnd: 200, q: 0.6, gain: 0.55 * s, x, y });
    this.tone({ freq: 70, freqEnd: 40, dur: 0.12, type: 'square', gain: 0.15 * s, x, y });
  },
  ricochet(x, y) { this.tone({ freq: 2400, freqEnd: 900, dur: 0.12, type: 'triangle', gain: 0.07, x, y }); },
  thud(x, y) { this.noise({ dur: 0.08, type: 'lowpass', freq: 500, gain: 0.3, x, y }); },
  splat(x, y) {
    this.noise({ dur: 0.25, type: 'lowpass', freq: 600, freqEnd: 120, gain: 0.5, x, y });
    this.tone({ freq: 240, freqEnd: 90, dur: 0.18, type: 'sawtooth', gain: 0.08, x, y });
  },
  punch(x, y) { this.noise({ dur: 0.07, type: 'lowpass', freq: 900, gain: 0.35, x, y }); },
  pickup() {
    this.tone({ freq: 660, dur: 0.08, type: 'square', gain: 0.12 });
    this.tone({ freq: 990, dur: 0.12, type: 'square', gain: 0.12, delay: 0.07 });
  },
  horn(x, y) {
    this.tone({ freq: 392, dur: 0.35, type: 'sawtooth', gain: 0.12, x, y });
    this.tone({ freq: 494, dur: 0.35, type: 'sawtooth', gain: 0.1, x, y });
  },
  door(x, y) { this.tone({ freq: 140, freqEnd: 80, dur: 0.1, type: 'square', gain: 0.12, x, y }); },
  bust() { [523, 392, 330, 262].forEach((f, i) => this.tone({ freq: f, dur: 0.3, type: 'square', gain: 0.12, delay: i * 0.22 })); },
  wasted() { this.tone({ freq: 300, freqEnd: 60, dur: 1.6, type: 'sawtooth', gain: 0.2 }); },
  eject(x, y) {
    this.noise({ dur: 0.7, type: 'bandpass', freq: 300, freqEnd: 3000, q: 0.8, gain: 0.8, x, y });
    this.tone({ freq: 180, freqEnd: 900, dur: 0.35, type: 'square', gain: 0.15, x, y });
  },
  glider() { this.noise({ dur: 0.3, type: 'lowpass', freq: 500, freqEnd: 150, gain: 0.5, attack: 0.02 }); },
  star() { this.tone({ freq: 880, freqEnd: 660, dur: 0.25, type: 'square', gain: 0.08 }); },

  update() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, p = G.player;
    let eg = 0, ef = 40;
    if (p && p.inCar && !p.inCar.dead && G.running()) {
      const car = p.inCar, sp = Math.abs(car.fwdSpeed());
      const gearSp = sp % 180;
      ef = 38 + gearSp * 0.35 + sp * 0.05;
      eg = 0.07 + Math.min(0.08, sp / 5000);
    }
    this.engA.frequency.setTargetAtTime(ef, t, 0.05);
    this.engB.frequency.setTargetAtTime(ef * 1.01 / 2, t, 0.05);
    this.engG.gain.setTargetAtTime(eg, t, 0.08);

    let sg = 0;
    if (G.stars() > 0 && G.running()) {
      let best = 1e9;
      for (const c of G.cars) if (c.driver === 'cop' && !c.dead) best = Math.min(best, dist(c.x, c.y, G.cam.x, G.cam.y));
      sg = clamp(1 - best / 1300, 0, 1) * 0.06;
    }
    this.sirO.frequency.setTargetAtTime(Math.sin(G.time * 3.2) > 0 ? 960 : 720, t, 0.02);
    this.sirG.gain.setTargetAtTime(sg, t, 0.1);

    const a = p && p.air;
    const wg = a && G.running() ? (a.mode === 'glide' ? 0.03 + a.speed / 9000 : 0.08) : 0;
    this.windF.frequency.setTargetAtTime(a ? 300 + (a.mode === 'glide' ? a.speed : 400) : 500, t, 0.2);
    this.windG.gain.setTargetAtTime(wg, t, 0.15);
  },
};
