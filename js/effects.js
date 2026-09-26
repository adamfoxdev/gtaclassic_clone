'use strict';
// Particles, ground decals (blood, scorch, corpses, skid marks), light flashes and floating text.

const FX = {
  parts: [], decals: [], skids: [], lights: [], popups: [],

  add(o) { if (this.parts.length < 1800) { o.max = o.life; this.parts.push(o); } },

  smoke(x, y, g = 0.45, size = 1, life = 1.8) {
    this.add({ k: 'smoke', x, y, vx: rand(-12, 12), vy: rand(-12, 12) - 8, life: rand(0.7, 1.2) * life, r: rand(6, 10) * size, grow: 16 * size, g, a: 0.5, drag: 1 });
  },
  fire(x, y, s = 1) {
    this.add({ k: 'fire', x, y, vx: rand(-25, 25), vy: rand(-25, 25) - 10, life: rand(0.25, 0.6), r: rand(5, 9) * s, grow: 5 * s, drag: 2 });
  },
  sparks(x, y, a, n = 6, sp = 260, spread = 0.9) {
    for (let i = 0; i < n; i++) {
      const aa = a + rand(-spread, spread), v = rand(0.3, 1) * sp;
      this.add({ k: 'spark', x, y, vx: Math.cos(aa) * v, vy: Math.sin(aa) * v, life: rand(0.12, 0.35), drag: 4 });
    }
  },
  debris(x, y, n, col = [40, 40, 40], sp = 320) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), v = rand(0.3, 1) * sp;
      this.add({ k: 'debris', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.6, 1.4), r: rand(2, 5), rot: rand(0, TAU), vr: rand(-12, 12), col, drag: 3 });
    }
  },
  blood(x, y, n, a) {
    for (let i = 0; i < n; i++) {
      const aa = (a === undefined ? rand(0, TAU) : a + rand(-0.8, 0.8)), v = rand(40, 200);
      this.add({ k: 'blood', x, y, vx: Math.cos(aa) * v, vy: Math.sin(aa) * v, life: rand(0.15, 0.4), r: rand(1.5, 3), drag: 6 });
    }
  },
  muzzle(x, y, a) {
    this.add({ k: 'flash', x: x + Math.cos(a) * 6, y: y + Math.sin(a) * 6, vx: 0, vy: 0, life: 0.05, r: rand(7, 11), drag: 0 });
    this.light(x, y, 90, 0.06, [255, 200, 120]);
  },
  shell(x, y, a) {
    const aa = a + Math.PI / 2 + rand(-0.3, 0.3), v = rand(60, 120);
    this.add({ k: 'shell', x, y, vx: Math.cos(aa) * v, vy: Math.sin(aa) * v, life: rand(0.3, 0.6), rot: rand(0, TAU), vr: rand(-20, 20), drag: 5 });
  },
  explosion(x, y, pw = 1) {
    // Scale detail down when lots of explosions are already on screen (chain reactions).
    pw *= this.parts.length > 900 ? 0.6 : 1;
    this.light(x, y, 380 * pw, 0.5, [255, 170, 80]);
    this.add({ k: 'ring', x, y, vx: 0, vy: 0, life: 0.35, r: 10, grow: 520 * pw, drag: 0 });
    for (let i = 0; i < 26 * pw; i++) {
      const a = rand(0, TAU), v = rand(20, 260) * pw;
      this.add({ k: 'fire', x: x + rand(-10, 10), y: y + rand(-10, 10), vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.35, 0.9), r: rand(10, 22) * pw, grow: 18, drag: 3.5 });
    }
    for (let i = 0; i < 15 * pw; i++) {
      const a = rand(0, TAU), v = rand(20, 160) * pw;
      this.add({ k: 'smoke', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(1.5, 3.2), r: rand(12, 22) * pw, grow: 26, g: rand(0.12, 0.3), a: 0.6, drag: 2.2, delay: rand(0.05, 0.3) });
    }
    this.sparks(x, y, 0, 26, 520, Math.PI);
    this.debris(x, y, 16, [30, 28, 26], 420);
    this.decal({ k: 'scorch', x, y, r: rand(55, 75) * pw });
  },

  decal(d) {
    this.decals.push(d);
    if (this.decals.length > 700) this.decals.shift();
  },
  bloodPool(x, y, r = 14) {
    const blobs = [];
    for (let i = 0; i < 5; i++) blobs.push([rand(-r * 0.6, r * 0.6), rand(-r * 0.6, r * 0.6), rand(r * 0.4, r * 0.9)]);
    this.decal({ k: 'blood', x, y, blobs });
  },
  skid(x0, y0, x1, y1) {
    this.skids.push(x0, y0, x1, y1);
    if (this.skids.length > 6000) this.skids.splice(0, 4);
  },
  light(x, y, r, life, col) { if (this.lights.length < 14) this.lights.push({ x, y, r, life, max: life, col }); },
  popup(x, y, text, col = '#7dff6a') { this.popups.push({ x, y, text, col, life: 1.4 }); },

  update(dt) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.life -= dt;
      if (p.life <= 0) {
        if (p.k === 'blood' && chance(0.5)) this.decal({ k: 'drop', x: p.x, y: p.y, r: p.r * 1.4 });
        ps[i] = ps[ps.length - 1]; ps.pop();
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
      if (p.grow) p.r += p.grow * dt;
      if (p.vr) p.rot += p.vr * dt;
    }
    for (let i = this.lights.length - 1; i >= 0; i--) if ((this.lights[i].life -= dt) <= 0) this.lights.splice(i, 1);
    for (let i = this.popups.length - 1; i >= 0; i--) { const p = this.popups[i]; p.life -= dt; p.y -= 30 * dt; if (p.life <= 0) this.popups.splice(i, 1); }
  },

  inView(x, y, v, m) { return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m; },

  drawGround(ctx, v) {
    // Skid marks, batched into one path.
    const s = this.skids;
    ctx.strokeStyle = 'rgba(15,15,15,0.4)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < s.length; i += 4) {
      if (!this.inView(s[i], s[i + 1], v, 20)) continue;
      ctx.moveTo(s[i], s[i + 1]); ctx.lineTo(s[i + 2], s[i + 3]);
    }
    ctx.stroke(); ctx.lineCap = 'butt';

    for (const d of this.decals) {
      if (!this.inView(d.x, d.y, v, 80)) continue;
      switch (d.k) {
        case 'scorch': {
          const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
          g.addColorStop(0, 'rgba(10,8,6,0.8)'); g.addColorStop(0.6, 'rgba(20,16,12,0.45)'); g.addColorStop(1, 'rgba(20,16,12,0)');
          ctx.fillStyle = g; circle(ctx, d.x, d.y, d.r);
          break;
        }
        case 'blood':
          ctx.fillStyle = 'rgba(120,8,8,0.85)';
          for (const b of d.blobs) circle(ctx, d.x + b[0], d.y + b[1], b[2]);
          break;
        case 'drop':
          ctx.fillStyle = 'rgba(130,10,10,0.8)'; circle(ctx, d.x, d.y, d.r);
          break;
        case 'corpse':
          drawCorpse(ctx, d);
          break;
        case 'oil':
          ctx.fillStyle = 'rgba(10,10,12,0.5)'; ellipse(ctx, d.x, d.y, d.r, d.r * 0.7);
          break;
      }
    }
  },

  drawParticles(ctx, v) {
    const ps = this.parts;
    // Pass 1: normal blend (debris, blood, shells).
    for (const p of ps) {
      if (p.delay > 0 || !this.inView(p.x, p.y, v, 60)) continue;
      if (p.k === 'debris') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = rgb(p.col); ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
        ctx.restore();
      } else if (p.k === 'blood') {
        ctx.fillStyle = '#a0100e'; circle(ctx, p.x, p.y, p.r);
      } else if (p.k === 'shell') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = '#d9b44a'; ctx.fillRect(-2, -1, 4, 2);
        ctx.restore();
      }
    }
    // Pass 2: additive (fire, sparks, flashes, shock rings).
    ctx.globalCompositeOperation = 'lighter';
    for (const p of ps) {
      if (p.delay > 0 || !this.inView(p.x, p.y, v, 80)) continue;
      const t = p.life / p.max;
      if (p.k === 'fire') {
        ctx.fillStyle = t > 0.65 ? `rgba(255,240,170,${t * 0.8})` : t > 0.35 ? `rgba(255,150,40,${t * 0.9})` : `rgba(200,50,10,${t})`;
        circle(ctx, p.x, p.y, p.r);
      } else if (p.k === 'spark') {
        ctx.strokeStyle = `rgba(255,220,120,${t})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
      } else if (p.k === 'flash') {
        ctx.fillStyle = 'rgba(255,230,150,0.9)'; circle(ctx, p.x, p.y, p.r);
      } else if (p.k === 'ring') {
        ctx.strokeStyle = `rgba(255,220,180,${t * 0.5})`; ctx.lineWidth = 6 * t + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  },

  drawHigh(ctx, v) {
    for (const p of this.parts) {
      if (p.k !== 'smoke' || p.delay > 0 || !this.inView(p.x, p.y, v, 100)) continue;
      const t = p.life / p.max, c = p.g * 255 | 0;
      ctx.fillStyle = `rgba(${c},${c},${c},${p.a * t})`;
      circle(ctx, p.x, p.y, p.r);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.lights) {
      const t = l.life / l.max;
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      g.addColorStop(0, rgb(l.col, 1, 0.55 * t)); g.addColorStop(1, rgb(l.col, 1, 0));
      ctx.fillStyle = g; circle(ctx, l.x, l.y, l.r);
    }
    ctx.globalCompositeOperation = 'source-over';
  },

  drawPopups(ctx) {
    ctx.textAlign = 'center'; ctx.font = 'bold 18px "Trebuchet MS", Arial, sans-serif';
    for (const p of this.popups) {
      const a = clamp(p.life, 0, 1);
      ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillText(p.text, p.x + 2, p.y + 2);
      ctx.globalAlpha = a; ctx.fillStyle = p.col; ctx.fillText(p.text, p.x, p.y); ctx.globalAlpha = 1;
    }
  },
};
