'use strict';
// Ejector seat and hang glider: blast out of a car, glide over the city, then land (or crash).
// Altitude `z` uses the same units as building heights, so the flight is drawn with the same
// perspective as the rooftops.

const AIR_GRAVITY = 700;
const AIR_CEILING = 900;
const ALT_TO_M = 0.1;   // z units -> metres on the altimeter
const GLIDER_SCALE = 1.35; // draw the wing a bit larger than life so it reads when zoomed out

function ejectPlayer() {
  const p = G.player, car = p.inCar;
  if (!car || p.air) return;
  car.driver = null; car.input = NO_INPUT;
  p.inCar = null;
  p.x = car.x; p.y = car.y;
  p.air = { mode: 'launch', z: 0, vz: 680, vx: car.vx * 0.85, vy: car.vy * 0.85,
    head: car.angle, bank: 0, speed: 0, spin: 0, stall: false, lift: 0, roofHit: false };
  for (let i = 0; i < 10; i++) FX.smoke(car.x + rand(-12, 12), car.y + rand(-12, 12), 0.8, 0.9, 1.2);
  FX.sparks(car.x, car.y, 0, 10, 240, Math.PI);
  FX.light(car.x, car.y, 160, 0.2, [255, 200, 120]);
  G.cam.shake += 6;
  Sfx.eject(car.x, car.y);
  message('EJECT!', '#ffcc33', 1.5);
}

function deployGlider(a) {
  const hs = Math.hypot(a.vx, a.vy);
  a.mode = 'glide';
  if (hs > 60) a.head = Math.atan2(a.vy, a.vx);
  a.speed = Math.max(hs, 220);
  a.bank = 0;
  Sfx.glider();
  message('Glider out: A/D turn, W dive, S pull up', '#9df', 3.5);
}

function cutGlider(a) {
  a.mode = 'fall';
  a.vx = Math.cos(a.head) * a.speed * 0.7; a.vy = Math.sin(a.head) * a.speed * 0.7;
  Sfx.glider();
  message('Glider cut loose!', '#fa3', 2);
}

// Rising air over explosions and burning cars.
function thermalLift(x, y) {
  let l = 0;
  for (const t of G.thermals) {
    const d = dist(x, y, t.x, t.y);
    if (d < t.r) l += t.power * (1 - d / t.r) * Math.min(1, t.life / 2);
  }
  for (const c of G.cars) {
    if (c.burnT < 0 && !(c.dead && c.deadT < 12)) continue;
    const d = dist(x, y, c.x, c.y);
    if (d < 150) l += 160 * (1 - d / 150);
  }
  return Math.min(l, 420);
}

function updateThermals(dt) {
  for (const t of G.thermals) t.life -= dt;
  G.thermals = G.thermals.filter(t => t.life > 0);
}

function updateAir(dt) {
  const p = G.player, a = p.air;
  const steer = ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0);
  const dive = keys.KeyW || keys.ArrowUp, flare = keys.KeyS || keys.ArrowDown;
  const px = p.x, py = p.y, pz = a.z;

  if (a.mode === 'glide') {
    a.bank += (steer * 0.65 - a.bank) * Math.min(1, dt * 4);
    a.head += a.bank * 2.1 * dt;
    let sink = 32, climb = 0;
    if (dive) { a.speed += 240 * dt; sink = 150; }
    else if (flare && a.speed > 150) { a.speed -= 190 * dt; climb = 95; sink = 0; }
    else a.speed += (a.speed > 230 ? -45 : 30) * dt;
    a.speed = clamp(a.speed, 120, 520);
    const wasStall = a.stall;
    a.stall = a.speed < 150;
    if (a.stall) {
      sink = 170;
      a.bank += Math.sin(G.time * 9) * 0.5 * dt;
      if (!wasStall) message('STALL! Dive to pick up speed', '#f63', 2);
    }
    a.lift = thermalLift(p.x, p.y);
    a.vz = climb - sink + a.lift;
    a.vx = Math.cos(a.head) * a.speed; a.vy = Math.sin(a.head) * a.speed;
  } else {
    a.vz -= AIR_GRAVITY * dt;
    const drag = Math.exp(-(a.mode === 'fall' ? 0.4 : 0.8) * dt);
    a.vx *= drag; a.vy *= drag;
    a.spin += dt * (a.mode === 'fall' ? 12 : 8);
    a.lift = 0;
    if (a.mode === 'launch' && a.vz < 0) deployGlider(a);
  }

  a.z = Math.min(AIR_CEILING, a.z + a.vz * dt);
  p.x = clamp(p.x + a.vx * dt, 0, MW * T);
  p.y = clamp(p.y + a.vy * dt, 0, MW * T);
  p.vx = a.vx; p.vy = a.vy;

  // Buildings: roofs catch you, walls bounce you back.
  const bh = World.heightAt(p.x, p.y);
  if (bh > 0 && a.z < bh) {
    const prevBh = World.heightAt(px, py);
    if (pz >= bh - 1 || prevBh >= bh) {
      if (!a.roofHit) {
        const impact = -a.vz;
        const dmg = a.mode === 'glide' ? Math.max(0, impact - 160) * 0.3 : Math.max(0, impact - 330) * 0.28;
        if (dmg > 0) playerHurt(dmg, { kind: 'fall', x: p.x, y: p.y });
        Sfx.thud(p.x, p.y);
        a.roofHit = true;
      }
      a.z = bh; a.vz = Math.max(0, a.vz);
      if (a.mode === 'glide') a.speed = Math.max(150, a.speed * Math.exp(-1.2 * dt));
      else if (Math.hypot(a.vx, a.vy) < 120) { a.vx = Math.cos(a.head) * 220; a.vy = Math.sin(a.head) * 220; }
      if (chance(dt * 12)) FX.smoke(p.x, p.y, 0.7, 0.5, 0.6);
    } else {
      p.x = px; p.y = py;
      const hitX = World.heightAt(px + a.vx * dt * 2, py) > a.z;
      const hitY = World.heightAt(px, py + a.vy * dt * 2) > a.z;
      if (hitX || !hitY) a.vx = -a.vx;
      if (hitY || !hitX) a.vy = -a.vy;
      const hs = Math.hypot(a.vx, a.vy);
      if (a.mode === 'glide') { a.head = Math.atan2(a.vy, a.vx); a.speed *= 0.55; }
      else { a.vx *= 0.4; a.vy *= 0.4; }
      playerHurt(6 + hs * 0.04, { kind: 'fall', x: p.x - a.vx, y: p.y - a.vy });
      FX.debris(p.x, p.y, 5, [120, 110, 100], 160);
      Sfx.thud(p.x, p.y);
      G.cam.shake += 5;
      message('Hit a building!', '#fa3', 1.5);
    }
  } else a.roofHit = false;

  if (p.air && a.z <= 0) landAir();
}

function landAir() {
  const p = G.player, a = p.air;
  p.air = null;
  p.ang = a.mode === 'glide' ? a.head : p.ang;
  if (World.at(p.x, p.y) === TL.WATER) {
    for (let i = 0; i < 16; i++) {
      const ang = rand(0, TAU), v = rand(40, 200);
      FX.add({ k: 'debris', x: p.x, y: p.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: rand(0.4, 0.9), r: rand(2, 4), rot: 0, vr: 0, col: [200, 230, 255], drag: 3 });
    }
    Sfx.splat(p.x, p.y);
    message('Splash! You can\'t swim.', '#6cf', 3);
    wasted({ kind: 'drown' });
    return;
  }
  const hv = Math.hypot(a.vx, a.vy);
  const dmg = a.mode === 'glide'
    ? Math.max(0, hv - 360) * 0.25 + Math.max(0, -a.vz - 160) * 0.3
    : Math.max(0, -a.vz - 330) * 0.28;
  for (let i = 0; i < 6; i++) FX.smoke(p.x + rand(-8, 8), p.y + rand(-8, 8), 0.7, 0.6, 0.8);
  Sfx.thud(p.x, p.y);
  collideCircle(p, p.r);
  if (dmg > 0) playerHurt(dmg, { kind: 'fall', x: p.x, y: p.y });
  if (!p.dead && a.mode === 'glide') message(dmg > 0 ? 'Rough landing' : 'Landed', '#9f9', 1.5);
}

// ---------- rendering ----------
function drawAirShadow(ctx) {
  const p = G.player, a = p.air;
  if (!a) return;
  const k = clamp(1 - a.z / 1200, 0.3, 1);
  const sx = p.x + a.z * 0.12, sy = p.y + a.z * 0.18;
  ctx.fillStyle = `rgba(0,0,0,${0.32 * k})`;
  if (a.mode === 'glide') {
    const cb = Math.cos(a.bank * 0.9);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(a.head); ctx.scale(GLIDER_SCALE, GLIDER_SCALE * cb);
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-16, -46); ctx.lineTo(-6, 0); ctx.lineTo(-16, 46); ctx.closePath(); ctx.fill();
    ctx.restore();
  } else ellipse(ctx, sx, sy, 9, 7);
}

function drawAirborne(ctx, cx, cy) {
  const p = G.player, a = p.air;
  if (!a) return;
  const s = 1 + a.z * 0.0012;
  ctx.save();
  ctx.translate(cx + (p.x - cx) * s, cy + (p.y - cy) * s);
  ctx.scale(s, s);
  if (a.mode === 'glide') {
    ctx.rotate(a.head);
    ctx.scale(GLIDER_SCALE, GLIDER_SCALE);
    drawGlider(ctx, a, p);
  } else {
    // Tumbling pilot: reuse the ped sprite at the origin.
    const ox = p.x, oy = p.y, oa = p.ang, om = p.moving;
    p.x = 0; p.y = 0; p.ang = a.spin; p.moving = true; p.phase += 0.4;
    drawPed(ctx, p);
    p.x = ox; p.y = oy; p.ang = oa; p.moving = om;
  }
  ctx.restore();
}

function drawGlider(ctx, a, p) {
  const cb = Math.cos(a.bank * 0.9), span = 46;
  const wob = a.stall ? Math.sin(G.time * 30) * 0.05 : 0;
  ctx.rotate(wob);
  // Pilot hanging prone under the sail.
  ctx.fillStyle = rgb(p.pants); ellipse(ctx, -13, 0, 7, 3.5);
  ctx.fillStyle = rgb(p.shirt); ellipse(ctx, -4, 0, 7, 5);
  ctx.fillStyle = rgb(p.hair); circle(ctx, 3, 0, 3.8);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(8, -9); ctx.lineTo(8, 9); ctx.stroke();

  ctx.save();
  ctx.scale(1, cb);
  const N = [20, 0], L = [-16, -span], R = [-16, span], K = [-6, 0];
  const mix = (u, v, t) => [lerp(u[0], v[0], t), lerp(u[1], v[1], t)];
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#ff6a1a';
  ctx.beginPath(); ctx.moveTo(N[0], N[1]); ctx.lineTo(L[0], L[1]); ctx.lineTo(K[0], K[1]); ctx.lineTo(R[0], R[1]); ctx.closePath(); ctx.fill();
  // Chevron stripe.
  const A = mix(N, L, 0.45), B = mix(N, L, 0.65), C = mix(N, R, 0.65), D = mix(N, R, 0.45), M1 = mix(N, K, 0.45), M2 = mix(N, K, 0.65);
  ctx.fillStyle = '#1fb5a8';
  ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(M2[0], M2[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.lineTo(M1[0], M1[1]); ctx.closePath(); ctx.fill();
  // The lowered wing looks darker when banking.
  if (Math.abs(a.bank) > 0.08) {
    const tip = a.bank > 0 ? R : L;
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.3, Math.abs(a.bank) * 0.4)})`;
    ctx.beginPath(); ctx.moveTo(N[0], N[1]); ctx.lineTo(tip[0], tip[1]); ctx.lineTo(K[0], K[1]); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#3a2a20'; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(L[0], L[1]); ctx.lineTo(N[0], N[1]); ctx.lineTo(R[0], R[1]); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(N[0], N[1]); ctx.lineTo(K[0], K[1]); ctx.stroke();
  ctx.restore();
}

function drawAirHUD(ctx, W, H, pad, u, font) {
  const a = G.player.air;
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.font = font(34);
  outlinedText(ctx, `ALT ${Math.round(a.z * ALT_TO_M)} m`, W - pad, H - pad - 44 * u, '#fff', 5 * u);
  ctx.font = font(18);
  const hs = a.mode === 'glide' ? a.speed : Math.hypot(a.vx, a.vy);
  const vs = a.vz * ALT_TO_M;
  outlinedText(ctx, `${Math.round(hs * 0.36)} km/h   ${vs >= 0 ? '▲' : '▼'} ${Math.abs(vs).toFixed(1)} m/s`, W - pad, H - pad - 20 * u, vs >= 0 ? '#8f8' : '#fa8', 3 * u);
  ctx.font = font(16);
  const label = a.mode === 'launch' ? 'EJECTING' : a.mode === 'fall' ? 'FREE FALL' : a.stall ? 'STALL' : a.lift > 60 ? 'THERMAL LIFT' : 'GLIDER';
  const col = a.mode === 'fall' || a.stall ? ((G.time * 4 % 1) < 0.5 ? '#f63' : '#fff') : a.lift > 60 ? '#ffcc33' : '#ccc';
  outlinedText(ctx, label, W - pad, H - pad, col, 3 * u);
}
