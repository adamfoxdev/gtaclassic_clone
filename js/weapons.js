'use strict';
// Weapons, projectiles, explosions and explosive barrels.

const WEAPONS = {
  fist:    { name: 'Fists',           kind: 'melee',   rate: 0.35, dmg: 18, range: 24, key: '1' },
  pistol:  { name: 'Pistol',          kind: 'bullet',  rate: 0.28, dmg: 28, spread: 0.03, speed: 1500, pellets: 1, pick: 36, snd: 'pistol', col: '#9ad' },
  uzi:     { name: 'Uzi',             kind: 'bullet',  rate: 0.075, dmg: 16, spread: 0.1, speed: 1500, pellets: 1, pick: 120, snd: 'uzi', col: '#7cf' },
  shotgun: { name: 'Shotgun',         kind: 'bullet',  rate: 0.85, dmg: 18, spread: 0.28, speed: 1300, pellets: 8, pick: 16, snd: 'shotgun', col: '#fa5' },
  flamer:  { name: 'Flamethrower',    kind: 'flame',   rate: 0.035, dmg: 5, pick: 300, snd: 'flamer', col: '#f73' },
  rocket:  { name: 'Rocket Launcher', kind: 'rocket',  rate: 1.1, pick: 8, snd: 'rocket', col: '#f44' },
  grenade: { name: 'Grenades',        kind: 'grenade', rate: 0.8, pick: 8, snd: 'throw', col: '#8d6' },
};
const WEAPON_ORDER = ['fist', 'pistol', 'uzi', 'shotgun', 'flamer', 'rocket', 'grenade'];
const PICKUP_LETTER = { pistol: 'P', uzi: 'U', shotgun: 'S', flamer: 'F', rocket: 'R', grenade: 'G' };

function alertPeds(x, y, r, panicCars = false) {
  const r2 = r * r;
  for (const p of G.peds) {
    if (p.type !== 'civ' || p.dead || p.inCar || p.burnT > 0) continue;
    const dx = p.x - x, dy = p.y - y;
    if (dx * dx + dy * dy < r2) p.flee(x, y);
  }
  if (panicCars) for (const c of G.cars) {
    if (c.driver === 'ai' && c.ai && dist(c.x, c.y, x, y) < r && chance(0.5)) c.ai.panicT = rand(2, 5);
  }
}

function fireWeapon(sh, wk, ang) {
  const w = WEAPONS[wk], isP = sh === G.player;
  const car = sh.inCar || null;
  const off = car ? car.t.w / 2 + 6 : 12;
  const ox = sh.x + Math.cos(ang) * off, oy = sh.y + Math.sin(ang) * off;
  const team = sh.type === 'cop' ? 'cop' : 'player';
  const base = { owner: sh, ownerCar: car, player: isP, team };
  switch (w.kind) {
    case 'melee': {
      const hx = sh.x + Math.cos(ang) * 14, hy = sh.y + Math.sin(ang) * 14;
      for (const p of G.peds) {
        if (p === sh || p.dead || p.inCar) continue;
        if (dist(p.x, p.y, hx, hy) < w.range) {
          p.damage(w.dmg, { player: isP, x: sh.x, y: sh.y, kind: 'melee' });
          Sfx.punch(hx, hy);
          if (isP && p.type === 'civ') addHeat(0.03);
          if (isP && p.type === 'cop') addHeat(0.5);
          return;
        }
      }
      return;
    }
    case 'bullet':
      for (let i = 0; i < w.pellets; i++) {
        const a = ang + rand(-w.spread, w.spread), sp = w.speed * rand(0.9, 1.1);
        G.proj.push(Object.assign({ kind: 'bullet', x: ox, y: oy, px: ox, py: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6, dmg: w.dmg * (team === 'cop' ? 0.55 : 1) }, base));
      }
      FX.muzzle(ox, oy, ang);
      FX.shell(sh.x, sh.y, ang);
      Sfx.shot(w.snd, ox, oy);
      alertPeds(ox, oy, 400, isP);
      break;
    case 'flame': {
      const a = ang + rand(-0.12, 0.12), sp = rand(380, 460);
      G.proj.push(Object.assign({ kind: 'flame', x: ox, y: oy, vx: Math.cos(a) * sp + (car ? car.vx : 0), vy: Math.sin(a) * sp + (car ? car.vy : 0), life: rand(0.4, 0.55), max: 0.55, dmg: w.dmg }, base));
      if (chance(0.3)) Sfx.shot('flamer', ox, oy);
      alertPeds(ox, oy, 300);
      break;
    }
    case 'rocket':
      G.proj.push(Object.assign({ kind: 'rocket', x: ox, y: oy, vx: Math.cos(ang) * 720, vy: Math.sin(ang) * 720, life: 2.5, ang }, base));
      Sfx.shot('rocket', ox, oy);
      FX.muzzle(ox, oy, ang);
      alertPeds(ox, oy, 400, isP);
      break;
    case 'grenade':
      G.proj.push(Object.assign({ kind: 'grenade', x: ox, y: oy, vx: Math.cos(ang) * 480 + (car ? car.vx : 0), vy: Math.sin(ang) * 480 + (car ? car.vy : 0), life: 1.7, rot: 0 }, base));
      Sfx.shot('throw', ox, oy);
      break;
  }
  if (isP && G.seen && G.heat < 1) { G.heat = 1; }
}

function hitBarrel(br, dmg, byPlayer, delay = 0.05) {
  br.hp -= dmg;
  if (br.hp <= 0 && br.fuse < 0) { br.fuse = delay; br.byPlayer = byPlayer; }
}

function updateProjectiles(dt) {
  const arr = G.proj;
  for (let i = arr.length - 1; i >= 0; i--) {
    const b = arr[i];
    b.life -= dt;
    let dead = false;
    if (b.life <= 0) {
      if (b.kind === 'grenade' || b.kind === 'rocket') explode(b.x, b.y, b.player, b.kind === 'rocket' ? 1 : 0.9);
      arr[i] = arr[arr.length - 1]; arr.pop();
      continue;
    }
    b.px = b.x; b.py = b.y;
    const sp = Math.hypot(b.vx, b.vy);
    const steps = Math.max(1, Math.ceil(sp * dt / 8)), sdt = dt / steps;
    for (let s = 0; s < steps && !dead; s++) {
      const nx = b.x + b.vx * sdt, ny = b.y + b.vy * sdt;
      if (World.solid(nx, ny)) {
        if (b.kind === 'grenade') {
          const sx = World.solid(nx, b.y), sy = World.solid(b.x, ny);
          if (sx || !sy) b.vx *= -0.5;
          if (sy || !sx) b.vy *= -0.5;
          Sfx.thud(b.x, b.y);
          break;
        }
        if (b.kind === 'rocket') explode(b.x, b.y, b.player, 1);
        else if (b.kind === 'bullet') { FX.sparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 4, 200); if (chance(0.3)) Sfx.ricochet(b.x, b.y); }
        dead = true; break;
      }
      b.x = nx; b.y = ny;
      if (b.kind === 'grenade') continue;

      for (const br of G.barrels) {
        if (br.dead || Math.abs(br.x - b.x) > 12 || Math.abs(br.y - b.y) > 12) continue;
        if (b.kind === 'rocket') { explode(b.x, b.y, b.player, 1); dead = true; }
        else if (b.kind === 'bullet') { hitBarrel(br, b.dmg, b.player); FX.sparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 3); dead = true; }
        else if (b.kind === 'flame') hitBarrel(br, 2, b.player, 0.8);
        break;
      }
      if (dead) break;

      for (const car of G.cars) {
        if (car === b.ownerCar || Math.abs(car.x - b.x) > 55 || Math.abs(car.y - b.y) > 55) continue;
        if (b.team === 'cop' && car.driver === 'cop') continue;
        if (!car.contains(b.x, b.y)) continue;
        if (b.kind === 'rocket') explode(b.x, b.y, b.player, 1);
        else if (b.kind === 'bullet') { car.damage(b.dmg, b.player, false); FX.sparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 3); if (chance(0.25)) Sfx.ricochet(b.x, b.y); }
        else if (b.kind === 'flame') car.damage(b.dmg, b.player, false);
        dead = true; break;
      }
      if (dead) break;

      for (const p of G.peds) {
        if (p === b.owner || p.dead || p.inCar) continue;
        if (b.team === 'cop' && p.type === 'cop') continue;
        const dx = p.x - b.x, dy = p.y - b.y;
        if (dx * dx + dy * dy > 100) continue;
        const src = { player: b.player, x: b.x - b.vx * 0.05, y: b.y - b.vy * 0.05, kind: b.kind };
        if (b.kind === 'rocket') { explode(b.x, b.y, b.player, 1); dead = true; }
        else if (b.kind === 'bullet') { p.damage(b.dmg, src); dead = true; }
        else if (b.kind === 'flame') p.ignite(src);
        break;
      }
    }
    if (dead) { arr[i] = arr[arr.length - 1]; arr.pop(); continue; }

    if (b.kind === 'rocket') {
      FX.smoke(b.x - b.vx * 0.02, b.y - b.vy * 0.02, 0.7, 0.6, 1);
      if (chance(0.7)) FX.fire(b.x - b.vx * 0.02, b.y - b.vy * 0.02, 0.5);
    } else if (b.kind === 'grenade') {
      const f = Math.exp(-2 * dt); b.vx *= f; b.vy *= f; b.rot += sp * dt * 0.05;
    } else if (b.kind === 'flame') {
      const f = Math.exp(-2.2 * dt); b.vx *= f; b.vy *= f;
    }
  }
}

function drawProjectiles(ctx) {
  for (const b of G.proj) {
    if (b.kind === 'bullet') {
      ctx.strokeStyle = 'rgba(255,240,180,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018); ctx.lineTo(b.x, b.y); ctx.stroke();
    } else if (b.kind === 'rocket') {
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.ang);
      ctx.fillStyle = '#556'; ctx.fillRect(-8, -2.5, 14, 5);
      ctx.fillStyle = '#c33'; ctx.fillRect(4, -2.5, 4, 5);
      ctx.restore();
    } else if (b.kind === 'grenade') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; circle(ctx, b.x + 2, b.y + 3, 4.5);
      ctx.fillStyle = '#3d5a2a'; circle(ctx, b.x, b.y, 4.5);
      ctx.fillStyle = (b.life * 6 % 1) < 0.5 ? '#f33' : '#600'; circle(ctx, b.x + Math.cos(b.rot) * 2, b.y + Math.sin(b.rot) * 2, 1.5);
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const b of G.proj) {
    if (b.kind !== 'flame') continue;
    const t = b.life / b.max, r = 4 + (1 - t) * 16;
    ctx.fillStyle = t > 0.6 ? `rgba(255,230,150,${t * 0.7})` : `rgba(255,${90 + t * 100 | 0},20,${t * 0.8})`;
    circle(ctx, b.x, b.y, r);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function explode(x, y, byPlayer, power = 1, srcCar = null) {
  const R = 140 * power;
  FX.explosion(x, y, power);
  Sfx.explosion(x, y);
  const cd = dist(x, y, G.cam.x, G.cam.y);
  G.cam.shake += 22 * power * clamp(1 - cd / 1200, 0, 1);
  for (const car of G.cars) {
    if (car === srcCar) continue;
    const d = Math.max(0, dist(x, y, car.x, car.y) - car.t.w * 0.3);
    if (d >= R) continue;
    const f = 1 - d / R, a = Math.atan2(car.y - y, car.x - x);
    car.damage(380 * f * power, byPlayer, true);
    car.vx += Math.cos(a) * 520 * f / car.t.mass; car.vy += Math.sin(a) * 520 * f / car.t.mass;
    car.av += rand(-5, 5) * f;
  }
  const src = { player: byPlayer, x, y, kind: 'explosion' };
  for (const p of G.peds) {
    if (p.dead || p.inCar) continue;
    const d = dist(x, y, p.x, p.y);
    if (d >= R * 0.9) continue;
    const f = 1 - d / (R * 0.9);
    p.damage(240 * f, src);
    if (!p.dead) {
      const a = Math.atan2(p.y - y, p.x - x);
      p.x += Math.cos(a) * 30 * f; p.y += Math.sin(a) * 30 * f;
      collideCircle(p, p.r);
      if (f > 0.35) p.ignite(src);
    }
  }
  for (const br of G.barrels) {
    if (br.dead || br.fuse >= 0) continue;
    const d = dist(x, y, br.x, br.y);
    if (d < R) { br.fuse = 0.1 + d / 900; br.byPlayer = byPlayer; }
  }
  alertPeds(x, y, 800, true);
  if (byPlayer) addHeat(0.15);
}

function updateBarrels(dt) {
  for (const br of G.barrels) {
    if (br.dead) {
      br.respawnT -= dt;
      if (br.respawnT <= 0 && !inView(br.spot.x, br.spot.y, 100)) { br.dead = false; br.x = br.spot.x; br.y = br.spot.y; br.hp = 20; br.fuse = -1; }
      continue;
    }
    if (br.fuse >= 0) {
      br.fuse -= dt;
      if (chance(0.5)) FX.fire(br.x + rand(-5, 5), br.y + rand(-5, 5), 0.7);
      if (br.fuse < 0) { br.dead = true; br.respawnT = 60; explode(br.x, br.y, br.byPlayer, 1.1); }
    }
  }
}

function drawBarrels(ctx) {
  for (const br of G.barrels) {
    if (br.dead || !inView(br.x, br.y, 20)) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; circle(ctx, br.x + 3, br.y + 4, 10);
    ctx.fillStyle = '#b81e14'; circle(ctx, br.x, br.y, 10);
    ctx.strokeStyle = '#7a120c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(br.x, br.y, 6.5, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#f2c230';
    ctx.beginPath(); ctx.moveTo(br.x, br.y - 4.5); ctx.lineTo(br.x + 4, br.y + 3); ctx.lineTo(br.x - 4, br.y + 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; circle(ctx, br.x - 3, br.y - 3, 2.5);
  }
}
