'use strict';
// Pedestrians, cops on foot and the player character (shares the Ped body).

const SKINS = [[241, 194, 160], [224, 172, 105], [198, 134, 66], [141, 85, 36], [92, 59, 35]];
const SHIRTS = [[200, 50, 50], [50, 90, 180], [230, 230, 220], [60, 140, 70], [220, 170, 40], [130, 60, 150],
  [40, 40, 45], [230, 120, 150], [90, 170, 190], [180, 110, 60], [120, 120, 130]];
const PANTS = [[40, 50, 90], [30, 30, 34], [110, 90, 70], [70, 70, 80], [150, 130, 100], [60, 80, 60]];
const HAIRS = [[20, 16, 12], [70, 45, 25], [140, 100, 50], [200, 170, 110], [120, 120, 120], [160, 50, 20]];

let _pedId = 1;
class Ped {
  constructor(x, y, type = 'civ') {
    this.id = _pedId++;
    this.x = x; this.y = y; this.type = type; this.r = 8;
    this.ang = Math.floor(Math.random() * 4) * Math.PI / 2;
    this.vx = 0; this.vy = 0;
    this.hp = type === 'cop' ? 70 : type === 'player' ? 100 : 35;
    this.state = 'walk'; this.stateT = 0;
    this.speed = rand(38, 56); this.runSp = rand(115, 140);
    this.phase = Math.random() * TAU; this.moving = false;
    this.skin = pick(SKINS); this.hair = pick(HAIRS);
    this.shirt = type === 'cop' ? [36, 56, 130] : pick(SHIRTS);
    this.pants = type === 'cop' ? [24, 30, 60] : pick(PANTS);
    this.dead = false; this.inCar = null;
    this.fireCd = rand(0.5, 1.2); this.burnT = 0; this.burnSrc = null;
    this.fleeT = 0; this.turnT = rand(2, 7);
    this.weapon = type === 'cop' ? 'pistol' : null;
    this.alerted = false; this.losT = 0; this.los = false; this.onRoad = false; this.hitT = 0;
  }

  flee(fx, fy, t = 1) {
    if (this.type !== 'civ' && this.type !== 'cop') return;
    this.state = 'flee';
    this.fleeT = rand(3, 6) * t;
    this.ang = Math.atan2(this.y - fy, this.x - fx) + rand(-0.5, 0.5);
    this.turnT = rand(0.4, 1);
  }

  ignite(src) {
    if (this.dead || this.inCar) return;
    if (this.burnT <= 0) { this.burnT = this.type === 'player' ? 2.5 : 4; this.burnSrc = src; }
  }

  damage(amt, src, silent) {
    if (this.dead) return;
    if (this.type === 'player') { playerHurt(amt, src); return; }
    this.hp -= amt;
    this.hitT = 0.12;
    if (!silent) FX.blood(this.x, this.y, Math.min(8, 2 + (amt / 8 | 0)), src ? Math.atan2(this.y - src.y, this.x - src.x) : undefined);
    if (this.hp <= 0) { this.die(src); return; }
    if (this.type === 'civ' && src) this.flee(src.x, src.y);
    if (this.type === 'cop' && src && src.player) { addHeat(0.3); this.alerted = true; }
  }

  die(src) {
    this.dead = true;
    let cx = this.x, cy = this.y;
    if (src && (src.kind === 'car' || src.kind === 'explosion')) {
      const a = Math.atan2(this.y - src.y, this.x - src.x), f = src.kind === 'car' ? 26 : 34;
      if (!World.solid(cx + Math.cos(a) * f, cy + Math.sin(a) * f)) { cx += Math.cos(a) * f; cy += Math.sin(a) * f; }
    }
    FX.blood(this.x, this.y, 14);
    FX.bloodPool(cx, cy);
    FX.decal({ k: 'corpse', x: cx, y: cy, ang: rand(0, TAU), shirt: this.shirt, pants: this.pants, skin: this.skin, hair: this.hair,
      cop: this.type === 'cop', burnt: this.burnT > 0 || (src && src.kind === 'explosion' && chance(0.5)) });
    Sfx.splat(this.x, this.y);
    if (src && src.player) {
      G.kills++;
      if (this.type === 'cop') { reward(this.x, this.y, 100); addHeat(0.8); if (G.heat < 2) G.heat = 2; }
      else { reward(this.x, this.y, randi(2, 8) * 5); addHeat(0.3); }
    }
    if (this.type === 'cop' && chance(0.5)) G.pickups.push({ x: cx + rand(-10, 10), y: cy + rand(-10, 10), kind: 'weapon', wk: 'pistol', amount: 12, temp: 20 });
    else if (this.type === 'civ' && chance(0.3)) G.pickups.push({ x: cx + rand(-10, 10), y: cy + rand(-10, 10), kind: 'money', amount: randi(2, 10) * 5, temp: 20 });
    alertPeds(this.x, this.y, 220);
  }

  moveDir(a, sp, dt) {
    this.moving = sp > 1;
    this.phase += sp * dt * 0.16;
    this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
    this.x += this.vx * dt; this.y += this.vy * dt;
    let hit = collideCircle(this, this.r);
    for (const b of G.barrels) {
      if (b.dead) continue;
      const dx = this.x - b.x, dy = this.y - b.y, d = Math.hypot(dx, dy);
      if (d < this.r + 10 && d > 0) { this.x = b.x + dx / d * (this.r + 10); this.y = b.y + dy / d * (this.r + 10); hit = true; }
    }
    return hit;
  }

  update(dt) {
    if (this.dead || this.inCar) return;
    this.hitT = Math.max(0, this.hitT - dt);
    if (this.burnT > 0) {
      this.burnT -= dt;
      if (chance(dt * 30)) FX.fire(this.x + rand(-5, 5), this.y + rand(-5, 5), 0.6);
      this.damage((this.type === 'player' ? 14 : 22) * dt, this.burnSrc, true);
      if (this.dead) return;
      if (this.type !== 'player') {
        this.turnT -= dt;
        if (this.turnT <= 0) { this.ang += rand(-1.5, 1.5); this.turnT = rand(0.2, 0.5); }
        this.moveDir(this.ang, 140, dt);
        return;
      }
    }
    if (this.type === 'player') return;
    if (this.type === 'cop') this.copLogic(dt); else this.civLogic(dt);
  }

  pickDir() {
    const opts = [];
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      if (!pedWalkable(World.at(this.x + Math.cos(a) * 24, this.y + Math.sin(a) * 24))) continue;
      if (Math.abs(angDiff(this.ang, a)) > 3) continue;
      opts.push(a);
    }
    this.ang = opts.length ? pick(opts) : this.ang + Math.PI;
  }

  civLogic(dt) {
    if (this.state === 'flee') {
      this.fleeT -= dt; this.turnT -= dt;
      if (this.turnT <= 0) { this.ang += rand(-0.6, 0.6); this.turnT = rand(0.4, 1); }
      if (this.moveDir(this.ang, this.runSp, dt)) this.ang += rand(-2, 2);
      if (this.fleeT <= 0) { this.state = 'walk'; this.ang = Math.round(this.ang / (Math.PI / 2)) * Math.PI / 2; }
      return;
    }
    if (this.state === 'idle') {
      this.moving = false; this.stateT -= dt;
      if (this.stateT <= 0) { this.state = 'walk'; this.pickDir(); }
      return;
    }
    const c = Math.cos(this.ang), s = Math.sin(this.ang);
    const ahead = World.at(this.x + c * 16, this.y + s * 16), here = World.at(this.x, this.y);
    if (this.state === 'walk' && here === TL.ROAD) { this.state = 'cross'; this.onRoad = true; }
    if (this.state === 'cross') {
      if (here === TL.ROAD) this.onRoad = true;
      else if (this.onRoad) { this.state = 'walk'; this.onRoad = false; }
      if (isSolidT(ahead)) { this.state = 'walk'; this.pickDir(); }
    } else {
      if (!pedWalkable(ahead)) {
        if (ahead === TL.ROAD && here === TL.SIDEWALK && chance(0.2)) { this.state = 'cross'; this.onRoad = false; }
        else this.pickDir();
      }
      this.turnT -= dt;
      if (this.turnT <= 0) {
        this.turnT = rand(3, 9);
        if (chance(0.25)) { this.state = 'idle'; this.stateT = rand(1, 3); return; }
        this.pickDir();
      }
    }
    this.moveDir(this.ang, this.speed, dt);
  }

  copLogic(dt) {
    const p = G.player, stars = G.stars();
    if (stars === 0 || p.dead || G.overT > 0) { this.alerted = false; this.civLogic(dt); return; }
    const tgt = p.inCar || p;
    const dx = tgt.x - this.x, dy = tgt.y - this.y, d = Math.hypot(dx, dy);
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = 0.3; this.los = d < 700 && hasLOS(this.x, this.y, tgt.x, tgt.y); }
    const shooting = stars >= 2 && this.los && d < 380;
    let sp = d > 40 ? 118 : 0;
    if (shooting && d < 200) sp = 25;
    const a = Math.atan2(dy, dx);
    if (this.state === 'flee' && this.fleeT > 0) { this.fleeT -= dt; this.moveDir(this.ang, this.runSp, dt); return; }
    this.ang = a;
    if (sp > 0 && this.moveDir(a, sp, dt)) {
      // Blocked by a wall: sidestep along it, sticking with one side for a while.
      if (!this.slideT || this.slideT < G.time) { this.slide = chance(0.5) ? 1 : -1; this.slideT = G.time + rand(1, 2.5); }
      this.moveDir(a + this.slide * Math.PI / 2, sp * 0.8, dt);
    }
    if (sp === 0) this.moving = false;
    if (shooting) {
      this.fireCd -= dt;
      if (this.fireCd <= 0) {
        const wk = stars >= 4 ? 'uzi' : 'pistol';
        fireWeapon(this, wk, a + rand(-0.12, 0.12));
        this.weapon = wk;
        this.fireCd = stars >= 4 ? rand(0.12, 0.2) : rand(0.7, 1.2);
        if (stars >= 4 && chance(0.08)) this.fireCd = 1.2;
      }
    }
    if (d < 24 && stars <= 2 && !p.air && (!p.inCar || p.inCar.speed < 30)) busted();
  }
}

// ---------- rendering ----------
function drawPed(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(p.ang);
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ellipse(ctx, 2, 3, 9, 7);
  const sw = p.moving ? Math.sin(p.phase) * 5 : 0;
  ctx.fillStyle = rgb(p.pants, 0.8);
  ellipse(ctx, sw, -3.5, 4, 2.4); ellipse(ctx, -sw, 3.5, 4, 2.4);
  const armed = p.weapon && p.weapon !== 'fist';
  ctx.fillStyle = rgb(p.skin);
  if (armed) {
    ctx.fillStyle = '#1a1a1a';
    const big = p.weapon === 'rocket' || p.weapon === 'flamer' || p.weapon === 'shotgun';
    ctx.fillRect(4, big ? 1 : -1.5, big ? 16 : 10, big ? 4 : 3);
    ctx.fillStyle = rgb(p.shirt, 0.9);
    ellipse(ctx, 3, -6, 4, 2.4); ellipse(ctx, 4, 5, 4, 2.4);
    ctx.fillStyle = rgb(p.skin); circle(ctx, 7, -2, 2.2); circle(ctx, 7, 2.5, 2.2);
  } else {
    ctx.fillStyle = rgb(p.shirt, 0.9);
    ellipse(ctx, -sw * 0.8, -7, 3.6, 2.4); ellipse(ctx, sw * 0.8, 7, 3.6, 2.4);
    ctx.fillStyle = rgb(p.skin); circle(ctx, -sw * 0.8 + 2.5, -7.5, 2); circle(ctx, sw * 0.8 + 2.5, 7.5, 2);
  }
  ctx.fillStyle = p.hitT > 0 ? '#fff' : rgb(p.shirt);
  ellipse(ctx, 0, 0, 5.5, 8.5);
  if (p.type === 'player') { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-1, -7, 2, 14); }
  ctx.fillStyle = rgb(p.skin); circle(ctx, 1.5, 0, 4.2);
  if (p.type === 'cop') {
    ctx.fillStyle = '#10183a'; circle(ctx, 0.5, 0, 4.8);
    ctx.fillStyle = '#e0c040'; circle(ctx, 1.5, 0, 1.3);
  } else {
    ctx.fillStyle = rgb(p.hair); ellipse(ctx, -0.5, 0, 3.8, 4.4);
  }
  ctx.restore();
}

function drawCorpse(ctx, d) {
  ctx.save();
  ctx.translate(d.x, d.y); ctx.rotate(d.ang);
  const f = d.burnt ? 0.25 : 0.85;
  ctx.fillStyle = rgb(d.pants, f); ellipse(ctx, -9, -4, 6, 2.6); ellipse(ctx, -9, 4, 6, 2.6);
  ctx.fillStyle = rgb(d.shirt, f); ellipse(ctx, 0, 0, 7, 5.5);
  ellipse(ctx, 3, -8, 5, 2.2); ellipse(ctx, 5, 7, 5, 2.2);
  ctx.fillStyle = rgb(d.skin, f); circle(ctx, 8, -9, 2); circle(ctx, 10, 8, 2);
  ctx.fillStyle = d.cop ? rgb([16, 24, 58], f) : rgb(d.hair, f); circle(ctx, 10, 0, 4.5);
  ctx.restore();
}
